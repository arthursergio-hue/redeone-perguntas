-- Rede One · 3ª etapa: pergunta do pastor (todos respondem, mural no telão) e "palestra no telão" (um QR só)
-- O Pastor Paulo preferiu o papel na dinâmica; a palestra dele volta a ser de perguntas + a pergunta do pastor.

create table if not exists redeone.config (
  id            int primary key default 1 check (id = 1),
  evento_ativo  text not null references redeone.eventos(id)
);
alter table redeone.config enable row level security;
insert into redeone.config (id, evento_ativo) values (1, 'rede-one-2026') on conflict (id) do nothing;

alter table redeone.eventos
  add column if not exists pergunta_pastor text not null default '',
  add column if not exists pastor_aberta boolean not null default false;
alter table redeone.eventos drop constraint if exists eventos_telao_modo_check;
alter table redeone.eventos add constraint eventos_telao_modo_check check (telao_modo in ('perguntas','apresentacao','resposta'));

alter table redeone.respostas add column if not exists nome text check (nome is null or char_length(nome) between 1 and 60);
alter table redeone.respostas drop constraint if exists respostas_texto_check;
alter table redeone.respostas add constraint respostas_texto_check check (char_length(texto) between 2 and 280);

update redeone.eventos set modo = 'perguntas', aprovar_antes = true where id = 'rede-one-paulo';

-- "ativo" = a palestra que está no telão agora
create or replace function redeone.resolver(p text) returns text
language sql stable set search_path = '' as $$
  select case when p = 'ativo' then (select evento_ativo from redeone.config where id = 1) else p end;
$$;

create or replace function redeone.avisar_ativo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('evento', new.evento_ativo), 'mudou', 'redeone:ativo', false);
  return null;
exception when others then return null;
end $$;
drop trigger if exists config_avisar on redeone.config;
create trigger config_avisar after update on redeone.config for each row execute function redeone.avisar_ativo();

-- ── Público: responder a pergunta do pastor ────────────────────────────────
create or replace function redeone.responder_pastor(p_evento text, p_texto text, p_nome text,
                                                    p_dispositivo text, p_ip_hash text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  ev redeone.eventos%rowtype;
  txt text := redeone.limpar(p_texto);
  nm  text := nullif(redeone.limpar(p_nome), '');
  ultima timestamptz;
begin
  select * into ev from redeone.eventos where id = p_evento;
  if not found then return jsonb_build_object('ok', false, 'erro', 'evento'); end if;
  if not ev.pastor_aberta or ev.pergunta_pastor = '' then return jsonb_build_object('ok', false, 'erro', 'pastor_fechada'); end if;
  if char_length(txt) < 2 then return jsonb_build_object('ok', false, 'erro', 'curta'); end if;
  if char_length(txt) > 280 then return jsonb_build_object('ok', false, 'erro', 'longa'); end if;
  if nm is not null then nm := left(nm, 60); end if;
  if coalesce(p_dispositivo,'') !~ '^[A-Za-z0-9-]{8,64}$' then return jsonb_build_object('ok', false, 'erro', 'dispositivo'); end if;
  if redeone.tem_palavrao(txt) or redeone.tem_palavrao(nm) then return jsonb_build_object('ok', false, 'erro', 'palavrao'); end if;
  select max(criada_em) into ultima from redeone.respostas
   where dispositivo = p_dispositivo and evento_id = p_evento and mesa = 0;
  if ultima is not null and ultima > now() - interval '10 seconds' then
    return jsonb_build_object('ok', false, 'erro', 'espera',
      'espera_s', ceil(extract(epoch from (ultima + interval '10 seconds' - now())))::int);
  end if;
  insert into redeone.respostas (evento_id, mesa, grupo, rodada, texto, nome, dispositivo, ip_hash)
  values (p_evento, 0, 0, 0, txt, nm, p_dispositivo, p_ip_hash);
  return jsonb_build_object('ok', true);
end $$;

-- ── Telão / celular ────────────────────────────────────────────────────────
create or replace function redeone.telao(p_evento text) returns jsonb
language plpgsql stable set search_path = '' as $$
declare ev redeone.eventos%rowtype; res jsonb;
begin
  select * into ev from redeone.eventos where id = p_evento;
  if not found then return jsonb_build_object('evento', null); end if;

  res := jsonb_build_object(
    'evento_id', ev.id,
    'evento', jsonb_build_object(
      'titulo', ev.titulo, 'subtitulo', ev.subtitulo, 'banner_url', ev.banner_url, 'aberto', ev.aberto,
      'modo', ev.modo, 'telao_modo', ev.telao_modo, 'slides_url', ev.slides_url, 'slides_total', ev.slides_total,
      'slide_atual', ev.slide_atual, 'mostrar_perguntas_slides', ev.mostrar_perguntas_slides,
      'rodada', ev.rodada, 'restante_s', redeone.restante_s(ev), 'pausada', ev.rodada_pausa_s is not null,
      'duracao_s', ev.duracao_s, 'foco_mesa', ev.foco_mesa, 'grupos', ev.grupos,
      'pergunta_pastor', ev.pergunta_pastor, 'pastor_aberta', ev.pastor_aberta),
    'destaque', (select jsonb_build_object('id', id, 'texto', texto, 'nome', nome)
                   from redeone.perguntas where id = ev.destaque_id and evento_id = p_evento
                    and status in ('aprovada','pendente')),
    'perguntas', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'texto', texto, 'nome', nome,
                                          'fixada', fixada, 'quando', coalesce(aprovada_em, criada_em))
                       order by fixada desc, coalesce(aprovada_em, criada_em) desc)
        from (select * from redeone.perguntas
               where evento_id = p_evento and status = 'aprovada'
               order by fixada desc, coalesce(aprovada_em, criada_em) desc
               limit 12) q), '[]'::jsonb),
    'respostas_pastor', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'texto', texto, 'nome', nome) order by criada_em desc)
        from (select * from redeone.respostas where evento_id = p_evento and mesa = 0 and not oculta
               order by criada_em desc limit 60) a), '[]'::jsonb),
    'total_respostas_pastor', (select count(*) from redeone.respostas where evento_id = p_evento and mesa = 0 and not oculta));

  if ev.modo = 'dinamica' then
    res := res || jsonb_build_object(
      'mesas', coalesce((select jsonb_agg(jsonb_build_object('numero', numero, 'pergunta', pergunta,
                                 'texto_ensina', case when ev.rodada >= 5 then texto_ensina else '' end)
                                 order by numero)
                           from redeone.mesas where evento_id = p_evento), '[]'::jsonb),
      'respostas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'mesa', mesa, 'grupo', grupo,
                                 'rodada', rodada, 'texto', texto) order by criada_em)
                               from redeone.respostas where evento_id = p_evento and mesa > 0 and not oculta), '[]'::jsonb));
  end if;
  return res;
end $$;

-- ── Controle ────────────────────────────────────────────────────────────────
create or replace function redeone.controle_listar(p_evento text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'evento_id', p_evento,
    'ativo', (select evento_ativo from redeone.config where id = 1),
    'eventos', (select jsonb_agg(jsonb_build_object('id', id, 'subtitulo', subtitulo) order by criado_em) from redeone.eventos),
    'evento', (select jsonb_build_object('titulo', titulo, 'subtitulo', subtitulo,
                 'aprovar_antes', aprovar_antes, 'aberto', aberto, 'banner_url', banner_url,
                 'modo', modo, 'telao_modo', telao_modo, 'slides_url', slides_url, 'slides_total', slides_total,
                 'slide_atual', slide_atual, 'mostrar_perguntas_slides', mostrar_perguntas_slides,
                 'destaque_id', destaque_id, 'rodada', rodada, 'restante_s', redeone.restante_s(e),
                 'pausada', rodada_pausa_s is not null, 'duracao_s', duracao_s, 'foco_mesa', foco_mesa,
                 'grupos', grupos, 'pergunta_pastor', pergunta_pastor, 'pastor_aberta', pastor_aberta)
                 from redeone.eventos e where id = p_evento),
    'perguntas', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'texto', texto, 'nome', nome, 'status', status,
               'fixada', fixada, 'criada_em', criada_em, 'aprovada_em', aprovada_em,
               'respondida_em', respondida_em) order by criada_em desc)
        from redeone.perguntas where evento_id = p_evento), '[]'::jsonb),
    'mesas', coalesce((select jsonb_agg(jsonb_build_object('numero', numero, 'pergunta', pergunta,
               'texto_ensina', texto_ensina) order by numero)
               from redeone.mesas where evento_id = p_evento), '[]'::jsonb),
    'respostas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'mesa', mesa, 'grupo', grupo,
               'rodada', rodada, 'texto', texto, 'nome', nome, 'oculta', oculta, 'criada_em', criada_em) order by criada_em desc)
               from redeone.respostas where evento_id = p_evento), '[]'::jsonb));
$$;

create or replace function redeone.controle_config(p_evento text, p_cfg jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  update redeone.eventos set
    aprovar_antes = coalesce((p_cfg->>'aprovar_antes')::boolean, aprovar_antes),
    aberto        = coalesce((p_cfg->>'aberto')::boolean, aberto),
    titulo        = coalesce(nullif(left(p_cfg->>'titulo', 80), ''), titulo),
    subtitulo     = coalesce(nullif(left(p_cfg->>'subtitulo', 120), ''), subtitulo),
    banner_url    = case when p_cfg ? 'banner_url' then nullif(left(p_cfg->>'banner_url', 500), '') else banner_url end,
    telao_modo    = coalesce(p_cfg->>'telao_modo', telao_modo),
    mostrar_perguntas_slides = coalesce((p_cfg->>'mostrar_perguntas_slides')::boolean, mostrar_perguntas_slides),
    slides_url    = case when p_cfg ? 'slides_url' then nullif(left(p_cfg->>'slides_url', 500), '') else slides_url end,
    slides_total  = case when p_cfg ? 'slides_url' then (p_cfg->>'slides_total')::int else slides_total end,
    slide_atual   = case when p_cfg ? 'slides_url' then 1 else slide_atual end,
    duracao_s     = coalesce(least(greatest((p_cfg->>'duracao_s')::int, 30), 1800), duracao_s),
    foco_mesa     = case when p_cfg ? 'foco_mesa' then (p_cfg->>'foco_mesa')::int else foco_mesa end,
    pergunta_pastor = case when p_cfg ? 'pergunta_pastor' then left(redeone.limpar(p_cfg->>'pergunta_pastor'), 200) else pergunta_pastor end,
    pastor_aberta = coalesce((p_cfg->>'pastor_aberta')::boolean, pastor_aberta)
  where id = p_evento;
  -- um PIN só para a conferência inteira
  if p_cfg ? 'novo_pin' and char_length(p_cfg->>'novo_pin') between 4 and 12 then
    update redeone.eventos set pin_hash = extensions.crypt(p_cfg->>'novo_pin', extensions.gen_salt('bf'));
  end if;
end $$;

create or replace function redeone.controle_ativar(p_evento text) returns void
language sql set search_path = '' as $$
  update redeone.config set evento_ativo = p_evento where id = 1 and exists (select 1 from redeone.eventos where id = p_evento);
$$;

revoke all on all functions in schema redeone from public, anon, authenticated;
revoke all on all tables in schema redeone from public, anon, authenticated;
