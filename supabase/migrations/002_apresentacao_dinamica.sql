-- Rede One · 2ª etapa: modo apresentação (slides + destaque) e dinâmica de mesas (Pastor Paulo)

alter table redeone.eventos
  add column if not exists modo text not null default 'perguntas' check (modo in ('perguntas','dinamica')),
  add column if not exists telao_modo text not null default 'perguntas' check (telao_modo in ('perguntas','apresentacao')),
  add column if not exists slides_url text,
  add column if not exists slides_total int,
  add column if not exists slide_atual int not null default 1,
  add column if not exists mostrar_perguntas_slides boolean not null default true,
  add column if not exists destaque_id uuid,
  add column if not exists rodada int not null default 0,          -- 0 = antes; 1..4 = rodadas; 5 = confronto
  add column if not exists rodada_fim timestamptz,
  add column if not exists rodada_pausa_s int,                     -- segundos que faltavam quando pausou
  add column if not exists duracao_s int not null default 120,
  add column if not exists foco_mesa int,
  add column if not exists grupos int not null default 4;

create table if not exists redeone.mesas (
  evento_id     text not null references redeone.eventos(id) on delete cascade,
  numero        int  not null check (numero between 1 and 8),
  pergunta      text not null default '',
  texto_ensina  text not null default '',
  primary key (evento_id, numero)
);

create table if not exists redeone.respostas (
  id          uuid primary key default gen_random_uuid(),
  evento_id   text not null references redeone.eventos(id) on delete cascade,
  mesa        int  not null,
  grupo       int  not null,
  rodada      int  not null,
  texto       text not null check (char_length(texto) between 2 and 200),
  dispositivo text not null,
  ip_hash     text,
  oculta      boolean not null default false,
  criada_em   timestamptz not null default now()
);
create index if not exists respostas_evento on redeone.respostas (evento_id, mesa, criada_em);
create index if not exists respostas_disp on redeone.respostas (dispositivo, criada_em desc);

alter table redeone.mesas     enable row level security;
alter table redeone.respostas enable row level security;

drop trigger if exists respostas_avisar on redeone.respostas;
create trigger respostas_avisar after insert or update or delete on redeone.respostas
  for each row execute function redeone.avisar();
drop trigger if exists mesas_avisar on redeone.mesas;
create trigger mesas_avisar after insert or update or delete on redeone.mesas
  for each row execute function redeone.avisar();

-- Em que mesa o grupo está na rodada (circuito: cada grupo passa uma vez por mesa)
create or replace function redeone.mesa_do_grupo(p_grupo int, p_rodada int, p_n int) returns int
language sql immutable set search_path = '' as $$
  select ((p_grupo - 1 + p_rodada - 1) % p_n) + 1;
$$;

create or replace function redeone.restante_s(ev redeone.eventos) returns int
language sql stable set search_path = '' as $$
  select case
    when ev.rodada_pausa_s is not null then ev.rodada_pausa_s
    when ev.rodada_fim is null then null
    else greatest(0, ceil(extract(epoch from (ev.rodada_fim - now())))::int) end;
$$;

-- ── O que o telão (e o celular) leem ───────────────────────────────────────
create or replace function redeone.telao(p_evento text) returns jsonb
language plpgsql stable set search_path = '' as $$
declare ev redeone.eventos%rowtype; res jsonb;
begin
  select * into ev from redeone.eventos where id = p_evento;
  if not found then return jsonb_build_object('evento', null); end if;

  res := jsonb_build_object(
    'evento', jsonb_build_object(
      'titulo', ev.titulo, 'subtitulo', ev.subtitulo, 'banner_url', ev.banner_url, 'aberto', ev.aberto,
      'modo', ev.modo, 'telao_modo', ev.telao_modo, 'slides_url', ev.slides_url, 'slides_total', ev.slides_total,
      'slide_atual', ev.slide_atual, 'mostrar_perguntas_slides', ev.mostrar_perguntas_slides,
      'rodada', ev.rodada, 'restante_s', redeone.restante_s(ev), 'pausada', ev.rodada_pausa_s is not null,
      'duracao_s', ev.duracao_s, 'foco_mesa', ev.foco_mesa, 'grupos', ev.grupos),
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
               limit 12) q), '[]'::jsonb));

  if ev.modo = 'dinamica' then
    res := res || jsonb_build_object(
      'mesas', coalesce((select jsonb_agg(jsonb_build_object('numero', numero, 'pergunta', pergunta,
                                 'texto_ensina', case when ev.rodada >= 5 then texto_ensina else '' end)
                                 order by numero)
                           from redeone.mesas where evento_id = p_evento), '[]'::jsonb),
      'respostas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'mesa', mesa, 'grupo', grupo,
                                 'rodada', rodada, 'texto', texto) order by criada_em)
                               from redeone.respostas where evento_id = p_evento and not oculta), '[]'::jsonb));
  end if;
  return res;
end $$;

-- ── Público: resposta da dinâmica ──────────────────────────────────────────
create or replace function redeone.responder(p_evento text, p_grupo int, p_texto text,
                                             p_dispositivo text, p_ip_hash text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  ev redeone.eventos%rowtype;
  txt text := redeone.limpar(p_texto);
  ultima timestamptz;
  m int;
begin
  select * into ev from redeone.eventos where id = p_evento;
  if not found or ev.modo <> 'dinamica' then return jsonb_build_object('ok', false, 'erro', 'evento'); end if;
  if not ev.aberto then return jsonb_build_object('ok', false, 'erro', 'fechado'); end if;
  if ev.rodada < 1 or ev.rodada > ev.grupos then return jsonb_build_object('ok', false, 'erro', 'fora_rodada'); end if;
  if ev.rodada_pausa_s is null and ev.rodada_fim is not null and now() > ev.rodada_fim + interval '15 seconds' then
    return jsonb_build_object('ok', false, 'erro', 'tempo');
  end if;
  if p_grupo is null or p_grupo < 1 or p_grupo > ev.grupos then return jsonb_build_object('ok', false, 'erro', 'grupo'); end if;
  if char_length(txt) < 2 then return jsonb_build_object('ok', false, 'erro', 'curta'); end if;
  if char_length(txt) > 200 then return jsonb_build_object('ok', false, 'erro', 'longa'); end if;
  if coalesce(p_dispositivo,'') !~ '^[A-Za-z0-9-]{8,64}$' then return jsonb_build_object('ok', false, 'erro', 'dispositivo'); end if;
  if redeone.tem_palavrao(txt) then return jsonb_build_object('ok', false, 'erro', 'palavrao'); end if;

  select max(criada_em) into ultima from redeone.respostas where dispositivo = p_dispositivo and evento_id = p_evento;
  if ultima is not null and ultima > now() - interval '8 seconds' then
    return jsonb_build_object('ok', false, 'erro', 'espera',
      'espera_s', ceil(extract(epoch from (ultima + interval '8 seconds' - now())))::int);
  end if;

  m := redeone.mesa_do_grupo(p_grupo, ev.rodada, ev.grupos);
  insert into redeone.respostas (evento_id, mesa, grupo, rodada, texto, dispositivo, ip_hash)
  values (p_evento, m, p_grupo, ev.rodada, txt, p_dispositivo, p_ip_hash);
  return jsonb_build_object('ok', true, 'mesa', m);
end $$;

-- ── Controle ────────────────────────────────────────────────────────────────
create or replace function redeone.controle_listar(p_evento text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'evento', (select jsonb_build_object('titulo', titulo, 'subtitulo', subtitulo,
                 'aprovar_antes', aprovar_antes, 'aberto', aberto, 'banner_url', banner_url,
                 'modo', modo, 'telao_modo', telao_modo, 'slides_url', slides_url, 'slides_total', slides_total,
                 'slide_atual', slide_atual, 'mostrar_perguntas_slides', mostrar_perguntas_slides,
                 'destaque_id', destaque_id, 'rodada', rodada, 'restante_s', redeone.restante_s(e),
                 'pausada', rodada_pausa_s is not null, 'duracao_s', duracao_s, 'foco_mesa', foco_mesa,
                 'grupos', grupos)
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
               'rodada', rodada, 'texto', texto, 'oculta', oculta, 'criada_em', criada_em) order by criada_em desc)
               from redeone.respostas where evento_id = p_evento), '[]'::jsonb));
$$;

create or replace function redeone.controle_agir(p_evento text, p_id uuid, p_acao text) returns void
language plpgsql set search_path = '' as $$
begin
  if p_acao = 'fixar' then
    update redeone.perguntas set fixada = false, atualizada_em = now()
     where evento_id = p_evento and fixada and id <> p_id;
    update redeone.perguntas set fixada = true, status = 'aprovada',
           aprovada_em = coalesce(aprovada_em, now()), atualizada_em = now()
     where evento_id = p_evento and id = p_id;
  elsif p_acao = 'desafixar' then
    update redeone.perguntas set fixada = false, atualizada_em = now() where evento_id = p_evento and id = p_id;
  elsif p_acao = 'aprovar' then
    update redeone.perguntas set status = 'aprovada', aprovada_em = now(), atualizada_em = now()
     where evento_id = p_evento and id = p_id;
  elsif p_acao = 'responder' then
    update redeone.perguntas set status = 'respondida', fixada = false, respondida_em = now(), atualizada_em = now()
     where evento_id = p_evento and id = p_id;
    update redeone.eventos set destaque_id = null where id = p_evento and destaque_id = p_id;
  elsif p_acao = 'ocultar' then
    update redeone.perguntas set status = 'oculta', fixada = false, atualizada_em = now()
     where evento_id = p_evento and id = p_id;
    update redeone.eventos set destaque_id = null where id = p_evento and destaque_id = p_id;
  elsif p_acao = 'pendente' then
    update redeone.perguntas set status = 'pendente', fixada = false, atualizada_em = now()
     where evento_id = p_evento and id = p_id;
    update redeone.eventos set destaque_id = null where id = p_evento and destaque_id = p_id;
  elsif p_acao = 'destacar' then
    update redeone.perguntas set status = 'aprovada', aprovada_em = coalesce(aprovada_em, now()), atualizada_em = now()
     where evento_id = p_evento and id = p_id;
    update redeone.eventos set destaque_id = p_id where id = p_evento;
  elsif p_acao = 'tirar_destaque' then
    update redeone.eventos set destaque_id = null where id = p_evento;
  elsif p_acao = 'ocultar_resposta' then
    update redeone.respostas set oculta = true where evento_id = p_evento and id = p_id;
  elsif p_acao = 'mostrar_resposta' then
    update redeone.respostas set oculta = false where evento_id = p_evento and id = p_id;
  else
    raise exception 'acao invalida' using errcode = 'P0001';
  end if;
end $$;

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
    foco_mesa     = case when p_cfg ? 'foco_mesa' then (p_cfg->>'foco_mesa')::int else foco_mesa end
  where id = p_evento;
  if p_cfg ? 'novo_pin' and char_length(p_cfg->>'novo_pin') between 4 and 12 then
    update redeone.eventos set pin_hash = extensions.crypt(p_cfg->>'novo_pin', extensions.gen_salt('bf'))
     where id = p_evento;
  end if;
end $$;

create or replace function redeone.controle_slide(p_evento text, p_delta int, p_ir int) returns void
language sql set search_path = '' as $$
  update redeone.eventos
     set slide_atual = least(greatest(coalesce(p_ir, slide_atual + coalesce(p_delta, 0)), 1), greatest(coalesce(slides_total, 1), 1))
   where id = p_evento;
$$;

create or replace function redeone.controle_rodada(p_evento text, p_acao text) returns void
language plpgsql set search_path = '' as $$
declare ev redeone.eventos%rowtype;
begin
  select * into ev from redeone.eventos where id = p_evento for update;
  if p_acao = 'iniciar' then
    update redeone.eventos set rodada = 1, rodada_fim = now() + make_interval(secs => duracao_s), rodada_pausa_s = null, foco_mesa = null where id = p_evento;
  elsif p_acao = 'proxima' then
    if ev.rodada >= ev.grupos then
      update redeone.eventos set rodada = ev.grupos + 1, rodada_fim = null, rodada_pausa_s = null, foco_mesa = 1 where id = p_evento;
    else
      update redeone.eventos set rodada = ev.rodada + 1, rodada_fim = now() + make_interval(secs => duracao_s), rodada_pausa_s = null where id = p_evento;
    end if;
  elsif p_acao = 'anterior' then
    update redeone.eventos set rodada = greatest(ev.rodada - 1, 0),
           rodada_fim = case when ev.rodada - 1 between 1 and ev.grupos then now() + make_interval(secs => duracao_s) end,
           rodada_pausa_s = null, foco_mesa = null where id = p_evento;
  elsif p_acao = 'mais30' then
    update redeone.eventos set rodada_fim = greatest(coalesce(rodada_fim, now()), now()) + interval '30 seconds',
           rodada_pausa_s = case when rodada_pausa_s is not null then rodada_pausa_s + 30 end where id = p_evento;
  elsif p_acao = 'pausar' then
    update redeone.eventos set rodada_pausa_s = redeone.restante_s(ev), rodada_fim = null where id = p_evento and ev.rodada_pausa_s is null;
  elsif p_acao = 'retomar' then
    update redeone.eventos set rodada_fim = now() + make_interval(secs => coalesce(ev.rodada_pausa_s, 0)), rodada_pausa_s = null where id = p_evento;
  elsif p_acao = 'zerar' then
    update redeone.eventos set rodada = 0, rodada_fim = null, rodada_pausa_s = null, foco_mesa = null where id = p_evento;
  else
    raise exception 'acao invalida' using errcode = 'P0001';
  end if;
end $$;

create or replace function redeone.controle_mesas(p_evento text, p_mesas jsonb) returns void
language plpgsql set search_path = '' as $$
declare m jsonb;
begin
  for m in select * from jsonb_array_elements(p_mesas) loop
    insert into redeone.mesas (evento_id, numero, pergunta, texto_ensina)
    values (p_evento, (m->>'numero')::int, left(coalesce(m->>'pergunta',''), 200), left(coalesce(m->>'texto_ensina',''), 1000))
    on conflict (evento_id, numero) do update set pergunta = excluded.pergunta, texto_ensina = excluded.texto_ensina;
  end loop;
end $$;

-- Evento da dinâmica do Pastor Paulo (mesmo PIN do evento principal)
insert into redeone.eventos (id, titulo, subtitulo, modo, aprovar_antes, pin_hash)
select 'rede-one-paulo', 'Rede One', 'Chamados para servir · Pastor Paulo', 'dinamica', false, pin_hash
  from redeone.eventos where id = 'rede-one-2026'
on conflict (id) do nothing;
insert into redeone.mesas (evento_id, numero, pergunta)
select 'rede-one-paulo', n, 'Pergunta da mesa ' || n || ' (o Pastor Paulo define)' from generate_series(1, 4) n
on conflict do nothing;

-- Bucket público só para os PDFs das apresentações
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('redeone', 'redeone', true, 52428800, array['application/pdf'])
on conflict (id) do nothing;

revoke all on all functions in schema redeone from public, anon, authenticated;
revoke all on all tables in schema redeone from public, anon, authenticated;
