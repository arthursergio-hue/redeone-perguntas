-- Rede One · 5ª etapa: preparo para centenas de celulares ao mesmo tempo, todos no mesmo Wi-Fi da igreja

-- Consulta leve para os celulares (só o estado da palestra, sem listas de perguntas e respostas)
create or replace function redeone.estado(p_evento text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('evento_id', id, 'evento', jsonb_build_object(
           'titulo', titulo, 'subtitulo', subtitulo, 'banner_url', banner_url, 'aberto', aberto, 'modo', modo,
           'pergunta_pastor', pergunta_pastor, 'pastor_aberta', pastor_aberta))
    from redeone.eventos where id = p_evento;
$$;

-- No Wi-Fi da igreja todo mundo sai pelo mesmo IP: o limite por IP vira só uma trava contra robô
-- (o limite de verdade continua sendo 1 pergunta a cada 30 s por aparelho).
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

  if p_ip_hash is not null then
    select count(*) into qtd_ip from redeone.perguntas
     where ip_hash = p_ip_hash and criada_em > now() - interval '1 minute';
    if qtd_ip >= 600 then
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

-- PIN: com 6 dígitos, 40 erros em 10 min ainda tornam o chute inviável, e um curioso no mesmo Wi-Fi
-- não tranca o Arthur fora do controle.
create or replace function redeone.pin_ok(p_evento text, p_pin text, p_ip_hash text) returns boolean
language plpgsql set search_path = '' as $$
declare falhas int; ok boolean;
begin
  select count(*) into falhas from redeone.tentativas_pin
   where ip_hash is not distinct from p_ip_hash and quando > now() - interval '10 minutes';
  if falhas >= 40 then raise exception 'bloqueado' using errcode = 'P0001'; end if;
  select pin_hash = extensions.crypt(coalesce(p_pin,''), pin_hash) into ok
    from redeone.eventos where id = p_evento;
  if not coalesce(ok, false) then
    insert into redeone.tentativas_pin (ip_hash) values (p_ip_hash);
    return false;
  end if;
  return true;
end $$;

create index if not exists perguntas_evento_texto on redeone.perguntas (evento_id, criada_em desc);

revoke all on all functions in schema redeone from public, anon, authenticated;
