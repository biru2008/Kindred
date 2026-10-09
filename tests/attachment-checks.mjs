import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
export async function testAttachments(db, { A, B, C, as, value, check }) {
  await db.exec("reset role");
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/006_attachments.sql", import.meta.url),
      "utf8",
    ),
  );
  await check("Chat files bucket is private with a 20 MB maximum", async () => {
    const bucket = (
      await db.query("select * from storage.buckets where id='chat-files'")
    ).rows[0];
    assert.equal(bucket.public, false);
    assert.equal(Number(bucket.file_size_limit), 20971520);
  });
  await as(A);
  const room = await value("select public.start_conversation($1::uuid[]) v", [
    [B],
  ]);
  const path = `${room}/${A}/10000000-0000-4000-8000-000000000001`;
  const mid = "20000000-0000-4000-8000-000000000001";
  async function upload(p, size = 1234, mime = "image/png") {
    await db.query(
      "insert into storage.objects(bucket_id,name,owner_id,metadata) values('chat-files',$1,$2,$3)",
      [p, A, JSON.stringify({ size, mimetype: mime })],
    );
  }
  async function send(p = path, id = mid, cid = room) {
    return value(
      "select to_jsonb(public.send_attachment($1,$2,$3,'photo.png','A photo')) v",
      [cid, id, p],
    );
  }
  await upload(path);
  await as(B);
  await check(
    "Unsent uploads are invisible to other conversation members",
    async () => {
      assert.equal(
        Number(
          await value("select count(*) v from storage.objects where name=$1", [
            path,
          ]),
        ),
        0,
      );
      await assert.rejects(() =>
        upload(`${room}/${A}/10000000-0000-4000-8000-000000000002`),
      );
    },
  );
  await as(C);
  await check("Outsiders cannot upload into a conversation", async () => {
    await assert.rejects(() =>
      upload(`${room}/${C}/10000000-0000-4000-8000-000000000003`),
    );
    await assert.rejects(() => send());
  });
  await as(A);
  await check(
    "Send persists attachment metadata and retries without duplicates",
    async () => {
      const message = await send();
      assert.equal(message.attachment.path, path);
      assert.equal(message.attachment.size, 1234);
      assert.deepEqual(await send(), message);
      assert.equal(
        Number(
          await value("select count(*) v from public.messages where id=$1", [
            mid,
          ]),
        ),
        1,
      );
    },
  );
  await as(B);
  await check(
    "Members can read attachments through history and storage policies",
    async () => {
      assert.equal(
        Number(
          await value("select count(*) v from storage.objects where name=$1", [
            path,
          ]),
        ),
        1,
      );
      assert.equal(
        (
          await db.query("select * from public.message_history($1)", [room])
        ).rows.find((m) => m.id === mid).attachment.name,
        "photo.png",
      );
      await assert.rejects(() =>
        send(path, "20000000-0000-4000-8000-000000000002"),
      );
      assert.equal(
        (
          await db.query(
            "delete from storage.objects where name=$1 returning id",
            [path],
          )
        ).rows.length,
        0,
      );
    },
  );
  await as(C);
  await check("Outsiders cannot read a saved file or its message", async () => {
    assert.equal(
      Number(
        await value("select count(*) v from storage.objects where name=$1", [
          path,
        ]),
      ),
      0,
    );
    assert.equal(
      Number(
        await value("select count(*) v from public.messages where id=$1", [
          mid,
        ]),
      ),
      0,
    );
  });
  await as(A);
  await check(
    "RPC rejects oversized files and unsupported content types",
    async () => {
      const large = `${room}/${A}/10000000-0000-4000-8000-000000000004`;
      await upload(large, 20971521);
      await assert.rejects(() =>
        send(large, "20000000-0000-4000-8000-000000000004"),
      );
      const html = `${room}/${A}/10000000-0000-4000-8000-000000000005`;
      await upload(html, 123, "text/html");
      await assert.rejects(() =>
        send(html, "20000000-0000-4000-8000-000000000005"),
      );
      assert.equal(
        (
          await db.query(
            "delete from storage.objects where name=$1 returning id",
            [large],
          )
        ).rows.length,
        1,
      );
    },
  );
  await check(
    "Existing attachment cannot be replaced or deleted from storage by its sender",
    async () => {
      const other = `${room}/${A}/10000000-0000-4000-8000-000000000006`;
      await upload(other);
      await assert.rejects(() => send(other));
      assert.equal(
        (
          await db.query(
            "delete from storage.objects where name=$1 returning id",
            [path],
          )
        ).rows.length,
        0,
      );
    },
  );
  await db.query("select public.delete_message($1)", [mid]);
  await as(B);
  await check(
    "Deleting a message prevents issuing new file downloads",
    async () => {
      assert.equal(
        Number(
          await value("select count(*) v from storage.objects where name=$1", [
            path,
          ]),
        ),
        0,
      );
    },
  );
  await as(A);
  const group = await value(
    "select public.start_conversation($1::uuid[],'File circle') v",
    [[B]],
  );
  await as(B);
  const invitation = (
    await value("select public.list_group_invitations() v")
  ).find((i) => i.conversation_id === group).id;
  await db.query("select public.respond_group_invitation($1,true)", [
    invitation,
  ]);
  await as(A);
  const gp = `${group}/${A}/10000000-0000-4000-8000-000000000007`;
  await upload(gp);
  await send(gp, "20000000-0000-4000-8000-000000000007", group);
  await as(B);
  assert.equal(
    Number(
      await value("select count(*) v from storage.objects where name=$1", [gp]),
    ),
    1,
  );
  await as(A);
  await db.query("select public.manage_group($1,$2,'remove')", [group, B]);
  await as(B);
  await check("Removed group members lose file access", async () => {
    assert.equal(
      Number(
        await value("select count(*) v from storage.objects where name=$1", [
          gp,
        ]),
      ),
      0,
    );
  });
  await as(null);
  await check("Anonymous callers cannot send attachment messages", async () => {
    await assert.rejects(() => send());
  });
}
