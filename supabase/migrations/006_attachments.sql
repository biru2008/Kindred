-- Apply once after migrations 001–005. Preserves existing messages/accounts.
begin;
alter table public.messages add column attachment jsonb;
create index messages_attachment_path_idx on public.messages ((attachment->>'path')) where attachment is not null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('chat-files','chat-files',false,20971520,array[
 'image/jpeg','image/png','image/webp','image/gif',
 'video/mp4','video/webm','video/quicktime',
 'audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/webm','audio/x-wav',
 'application/pdf','text/plain','text/csv',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]);

-- Paths: conversation UUID / uploader UUID / random UUID. No original filenames.
create function private.can_upload_chat_file(path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$' then return false; end if;
 return split_part(path,'/',2)=auth.uid()::text and private.is_member(split_part(path,'/',1)::uuid);
exception when invalid_text_representation then return false;
end; $$;
create function private.can_read_chat_file(path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.messages m where m.attachment->>'path'=path
 and m.deleted_at is null and private.is_member(m.conversation_id));
$$;
create function private.can_discard_chat_file(path text) returns boolean
language sql stable security definer set search_path='' as $$
 select private.email_verified() and split_part(path,'/',2)=auth.uid()::text
 and not exists(select 1 from public.messages m where m.attachment->>'path'=path);
$$;
revoke all on function private.can_upload_chat_file(text),private.can_read_chat_file(text),private.can_discard_chat_file(text) from public,anon;
grant execute on function private.can_upload_chat_file(text),private.can_read_chat_file(text),private.can_discard_chat_file(text) to authenticated;
create policy chat_files_insert on storage.objects for insert to authenticated
 with check(bucket_id='chat-files' and private.can_upload_chat_file(name));
create policy chat_files_read on storage.objects for select to authenticated
 using(bucket_id='chat-files' and (private.can_read_chat_file(name) or private.can_discard_chat_file(name)));
create policy chat_files_discard on storage.objects for delete to authenticated
 using(bucket_id='chat-files' and private.can_discard_chat_file(name));

create function public.send_attachment(conversation uuid,message_id uuid,object_path text,file_name text,caption text default '') returns public.messages
language plpgsql security definer set search_path='' as $$
declare obj storage.objects; result public.messages; info jsonb; message_body text; bytes bigint; mime text;
begin
 if not private.can_upload_chat_file(object_path) or split_part(object_path,'/',1)<>conversation::text then raise exception 'Conversation unavailable'; end if;
 if file_name is null or char_length(btrim(file_name)) not between 1 and 200 or file_name ~ '[[:cntrl:]/\\]' then raise exception 'Invalid filename'; end if;
 if caption is null or char_length(btrim(caption))>4000 then raise exception 'Caption must contain at most 4000 characters'; end if;
 select * into obj from storage.objects where bucket_id='chat-files' and name=object_path;
 if not found then raise exception 'Upload the file first'; end if;
 bytes := (obj.metadata->>'size')::bigint;
 mime := obj.metadata->>'mimetype';
 if bytes is null or bytes<1 or bytes>20971520 or mime is null or not (mime=any((select allowed_mime_types from storage.buckets where id='chat-files')::text[])) then raise exception 'Unsupported file or file exceeds 20 MB'; end if;
 info := jsonb_build_object('path',object_path,'name',btrim(file_name),'size',bytes,'mime',mime);
 message_body := coalesce(nullif(btrim(caption),''),btrim(file_name));
 -- Serialize duplicate retries and prevent attachment replacement on an existing ID.
 perform pg_advisory_xact_lock(hashtextextended(message_id::text,0));
 select * into result from public.messages where id=message_id;
 if found then
  if result.sender_id=auth.uid() and result.conversation_id=conversation and result.body=message_body and result.attachment=info and result.deleted_at is null then return result; end if;
  raise exception 'Message identifier already used';
 end if;
 result := public.send_message(conversation,message_id,message_body);
 update public.messages set attachment=info where id=message_id returning * into result;
 return result;
end; $$;
revoke all on function public.send_attachment(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.send_attachment(uuid,uuid,text,text,text) to authenticated;
commit;
