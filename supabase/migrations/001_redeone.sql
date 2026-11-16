-- Rede One · perguntas ao vivo no telão
-- Tudo no schema próprio "redeone". O público NÃO acessa as tabelas: todo acesso passa pela
-- Edge Function "redeone", que chama as funções abaixo. anon/authenticated não têm grant nenhum.

create schema if not exists redeone;
revoke all on schema redeone from public, anon, authenticated;

-- ── Tabelas ─────────────────────────────────────────────────────────────────
create table if not exists redeone.eventos (
  id            text primary key,
  titulo        text not null default 'Rede One',
  subtitulo     text not null default 'Mande sua pergunta',
  aprovar_antes boolean not null default true,
  aberto        boolean not null default true,
  banner_url    text,
  pin_hash      text not null,
  criado_em     timestamptz not null default now()
);

create table if not exists redeone.perguntas (
  id            uuid primary key default gen_random_uuid(),
  evento_id     text not null references redeone.eventos(id) on delete cascade,
  texto         text not null check (char_length(texto) between 3 and 280),
  nome          text check (nome is null or char_length(nome) between 1 and 60),
  status        text not null default 'pendente'
                check (status in ('pendente','aprovada','respondida','oculta')),
  fixada        boolean not null default false,
  dispositivo   text not null,
  ip_hash       text,
  criada_em     timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  aprovada_em   timestamptz,
  respondida_em timestamptz
);
create index if not exists perguntas_evento_status on redeone.perguntas (evento_id, status, criada_em);
create index if not exists perguntas_dispositivo on redeone.perguntas (dispositivo, criada_em desc);
create index if not exists perguntas_ip on redeone.perguntas (ip_hash, criada_em desc);

create table if not exists redeone.tentativas_pin (
  id        bigint generated always as identity primary key,
  ip_hash   text,
  quando    timestamptz not null default now()
);
create index if not exists tentativas_ip on redeone.tentativas_pin (ip_hash, quando desc);

alter table redeone.eventos        enable row level security;
alter table redeone.perguntas      enable row level security;
alter table redeone.tentativas_pin enable row level security;
-- Sem políticas: anon e authenticated não leem nem gravam nada diretamente.

-- ── Texto ───────────────────────────────────────────────────────────────────
create or replace function redeone.normalizar(t text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(
           translate(lower(coalesce(t,'')),
             'áàâãäéèêëíìîïóòôõöúùûüçñ@013457$',
             'aaaaaeeeeiiiiooooouuuucnaoieasts'),
           '(.)\1{2,}', '\1', 'g');   -- "porraaaa" -> "porra"
$$;

create or replace function redeone.tem_palavrao(t text) returns boolean
language sql immutable set search_path = '' as $$
  select redeone.normalizar(t) ~ (
    '(^|[^a-z])(' ||
    'porra|caralho|caralhos|krl|crl|merda|merdas|bosta|bostas|foda|fodase|foda-se|fuder|foder|fodido|fodida|' ||
    'fdp|pqp|puta|putas|puto|putaria|vagabunda|vagabundo|cacete|buceta|boceta|xoxota|xereca|piroca|' ||
    'pau no cu|cu|cuzao|arrombado|arrombada|viado|sapatao|corno|corna|otario|otaria|idiota|imbecil|' ||
    'babaca|retardado|retardada|desgracado|desgracada|filho da puta|filha da puta|vsf|vtnc|tnc|' ||
    'vai se foder|vai tomar no cu|punheta|siririca|safado|safada|piranha|rapariga|escroto|escrota|' ||
    'baitola|traveco|fuck|shit|bitch' ||
    ')([^a-z]|$)');
$$;

create or replace function redeone.limpar(t text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(coalesce(t,''), '\s+', ' ', 'g'));
$$;

-- ── Aviso em tempo real (broadcast público "redeone:<evento>") ──────────────
create or replace function redeone.avisar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ev text;
begin
  ev := case when tg_table_name = 'eventos' then coalesce(new.id, old.id)
             else coalesce(new.evento_id, old.evento_id) end;
  perform realtime.send(jsonb_build_object('evento', ev, 'tabela', tg_table_name),
                        'mudou', 'redeone:' || ev, false);
  return null;
exception when others then
  return null;  -- aviso nunca derruba a gravação; o polling cobre
end $$;

drop trigger if exists perguntas_avisar on redeone.perguntas;
create trigger perguntas_avisar after insert or update or delete on redeone.perguntas
  for each row execute function redeone.avisar();
drop trigger if exists eventos_avisar on redeone.eventos;
create trigger eventos_avisar after update on redeone.eventos
  for each row execute function redeone.avisar();

-- ── Público: enviar ─────────────────────────────────────────────────────────
create or replace function redeone.enviar(p_evento text, p_texto text, p_nome text,
                                          p_dispositivo text, p_ip_hash text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  ev redeone.eventos%rowtype;
  txt text := redeone.limpar(p_texto);
  nm  text := nullif(redeone.limpar(p_nome), '');
  ultima timestamptz;
  qtd_ip int;
  novo redeone.perguntas%rowtype;
begin
  select * into ev from redeone.eventos where id = p_evento;
  if not found then return jsonb_build_object('ok', false, 'erro', 'evento'); end if;
  if not ev.aberto then return jsonb_build_object('ok', false, 'erro', 'fechado'); end if;
  if char_length(txt) < 3 then return jsonb_build_object('ok', false, 'erro', 'curta'); end if;
  if char_length(txt) > 280 then return jsonb_build_object('ok', false, 'erro', 'longa'); end if;
  if nm is not null and char_length(nm) > 60 then nm := left(nm, 60); end if;
  if coalesce(p_dispositivo,'') !~ '^[A-Za-z0-9-]{8,64}$' then
    return jsonb_build_object('ok', false, 'erro', 'dispositivo');
  end if;
  if redeone.tem_palavrao(txt) or redeone.tem_palavrao(nm) then
    return jsonb_build_object('ok', false, 'erro', 'palavrao');
  end if;

  select max(criada_em) into ultima from redeone.perguntas
   where dispositivo = p_dispositivo and evento_id = p_evento;
  if ultima is not null and ultima > now() - interval '30 seconds' then
    return jsonb_build_object('ok', false, 'erro', 'espera',
      'espera_s', ceil(extract(epoch from (ultima + interval '30 seconds' - now())))::int);
  end if;

  if p_ip_hash is not null then  -- rede da igreja é uma só: limite largo por IP
    select count(*) into qtd_ip from redeone.perguntas
     where ip_hash = p_ip_hash and criada_em > now() - interval '1 minute';
    if qtd_ip >= 40 then
      return jsonb_build_object('ok', false, 'erro', 'espera', 'espera_s', 20);
    end if;
  end if;

  if exists (select 1 from redeone.perguntas where evento_id = p_evento
             and redeone.normalizar(texto) = redeone.normalizar(txt)
             and criada_em > now() - interval '10 minutes') then
    return jsonb_build_object('ok', false, 'erro', 'repetida');
  end if;

  insert into redeone.perguntas (evento_id, texto, nome, dispositivo, ip_hash, status, aprovada_em)
  values (p_evento, txt, nm, p_dispositivo, p_ip_hash,
          case when ev.aprovar_antes then 'pendente' else 'aprovada' end,
          case when ev.aprovar_antes then null else now() end)
  returning * into novo;

  return jsonb_build_object('ok', true, 'id', novo.id, 'status', novo.status);
end $$;

-- ── Público: o que o telão mostra ───────────────────────────────────────────
create or replace function redeone.telao(p_evento text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'evento', (select jsonb_build_object('titulo', titulo, 'subtitulo', subtitulo,
                                         'banner_url', banner_url, 'aberto', aberto)
                 from redeone.eventos where id = p_evento),
    'perguntas', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'texto', texto, 'nome', nome,
                                          'fixada', fixada, 'quando', coalesce(aprovada_em, criada_em))
                       order by fixada desc, coalesce(aprovada_em, criada_em) desc)
        from (select * from redeone.perguntas
               where evento_id = p_evento and status = 'aprovada'
               order by fixada desc, coalesce(aprovada_em, criada_em) desc
               limit 12) q), '[]'::jsonb));
$$;

-- ── Controle (PIN) ──────────────────────────────────────────────────────────
create or replace function redeone.pin_ok(p_evento text, p_pin text, p_ip_hash text) returns boolean
language plpgsql set search_path = '' as $$
declare falhas int; ok boolean;
begin
  select count(*) into falhas from redeone.tentativas_pin
   where ip_hash is not distinct from p_ip_hash and quando > now() - interval '10 minutes';
  if falhas >= 10 then raise exception 'bloqueado' using errcode = 'P0001'; end if;
  select pin_hash = extensions.crypt(coalesce(p_pin,''), pin_hash) into ok
    from redeone.eventos where id = p_evento;
  if not coalesce(ok, false) then
    insert into redeone.tentativas_pin (ip_hash) values (p_ip_hash);
    return false;
  end if;
  return true;
end $$;

create or replace function redeone.controle_listar(p_evento text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'evento', (select jsonb_build_object('titulo', titulo, 'subtitulo', subtitulo,
                 'aprovar_antes', aprovar_antes, 'aberto', aberto, 'banner_url', banner_url)
                 from redeone.eventos where id = p_evento),
    'perguntas', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'texto', texto, 'nome', nome, 'status', status,
               'fixada', fixada, 'criada_em', criada_em, 'aprovada_em', aprovada_em,
               'respondida_em', respondida_em) order by criada_em desc)
        from redeone.perguntas where evento_id = p_evento), '[]'::jsonb));
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
    update redeone.perguntas set fixada = false, atualizada_em = now()
     where evento_id = p_evento and id = p_id;
  elsif p_acao = 'aprovar' then
    update redeone.perguntas set status = 'aprovada', aprovada_em = now(), atualizada_em = now()
     where evento_id = p_evento and id = p_id;
  elsif p_acao = 'responder' then
    update redeone.perguntas set status = 'respondida', fixada = false,
           respondida_em = now(), atualizada_em = now()
     where evento_id = p_evento and id = p_id;
  elsif p_acao = 'ocultar' then
    update redeone.perguntas set status = 'oculta', fixada = false, atualizada_em = now()
     where evento_id = p_evento and id = p_id;
  elsif p_acao = 'pendente' then
    update redeone.perguntas set status = 'pendente', fixada = false, atualizada_em = now()
     where evento_id = p_evento and id = p_id;
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
    banner_url    = case when p_cfg ? 'banner_url' then nullif(left(p_cfg->>'banner_url', 500), '')
                         else banner_url end
  where id = p_evento;
  if p_cfg ? 'novo_pin' and char_length(p_cfg->>'novo_pin') between 4 and 12 then
    update redeone.eventos set pin_hash = extensions.crypt(p_cfg->>'novo_pin', extensions.gen_salt('bf'))
     where id = p_evento;
  end if;
end $$;

revoke all on all functions in schema redeone from public, anon, authenticated;
revoke all on all tables in schema redeone from public, anon, authenticated;
