-- Rede One · 4ª etapa: telão com imagem (banner) + perguntas, troca de imagem na hora, limpar testes antes do evento

alter table redeone.eventos drop constraint if exists eventos_telao_modo_check;
alter table redeone.eventos add constraint eventos_telao_modo_check
  check (telao_modo in ('perguntas','imagem','apresentacao','resposta'));

-- Banner oficial da conferência (storage público da igreja) como imagem padrão das duas palestras
update redeone.eventos
   set banner_url = 'https://kkhzmvcqcljptlntlmwm.supabase.co/storage/v1/object/public/evento-capas/e242eae2-2ff6-480b-bd83-f569b36a80e1.jpg'
 where banner_url is null;

-- O bucket passa a aceitar imagens além do PDF
update storage.buckets
   set allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp']
 where id = 'redeone';

-- Apaga perguntas e respostas de uma palestra (para limpar o ensaio antes do evento)
create or replace function redeone.controle_zerar(p_evento text) returns jsonb
language plpgsql set search_path = '' as $$
declare np int; nr int;
begin
  delete from redeone.perguntas where evento_id = p_evento; get diagnostics np = row_count;
  delete from redeone.respostas where evento_id = p_evento; get diagnostics nr = row_count;
  update redeone.eventos set destaque_id = null, pastor_aberta = false, pergunta_pastor = '',
         rodada = 0, rodada_fim = null, rodada_pausa_s = null, slide_atual = 1
   where id = p_evento;
  return jsonb_build_object('perguntas', np, 'respostas', nr);
end $$;

revoke all on all functions in schema redeone from public, anon, authenticated;
