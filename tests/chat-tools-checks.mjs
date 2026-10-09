import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
export async function testChatTools(db, { A, B, C, as, value, check }) {
  await db.exec("reset role");
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/007_chat_tools.sql", import.meta.url),
      "utf8",
    ),
  );
  await as(A);
  const room = await value("select public.start_conversation($1::uuid[]) v", [
    [B],
  ]);
  const original = "30000000-0000-4000-8000-000000000001",
    reply = "30000000-0000-4000-8000-000000000002";
  await db.query("select public.send_message($1,$2,'Original words')", [
    room,
    original,
  ]);
  const extras = () =>
    value("select public.chat_features($1,$2::uuid[]) v", [
      room,
      [reply, original],
    ]);
  await check(
    "Replies persist and retries preserve their original target",
    async () => {
      const send = () =>
        value("select to_jsonb(public.send_reply($1,$2,'A reply',$3)) v", [
          room,
          reply,
          original,
        ]);
      const m = await send();
      assert.equal(m.reply_to, original);
      assert.deepEqual(await send(), m);
      assert.equal((await extras()).replies[0].body, "Original words");
      await assert.rejects(() =>
        db.query("select public.send_reply($1,$2,'A reply',$3)", [
          room,
          reply,
          reply,
        ]),
      );
    },
  );
  await check(
    "Reply cannot reference another conversation or a deleted message",
    async () => {
      const other = await value(
        "select public.start_conversation($1::uuid[],'Reply isolation') v",
        [[B]],
      );
      await assert.rejects(() =>
        db.query("select public.send_reply($1,gen_random_uuid(),'Bad',$2)", [
          other,
          original,
        ]),
      );
      const deleted = "30000000-0000-4000-8000-000000000003";
      await db.query("select public.send_message($1,$2,'Gone')", [
        room,
        deleted,
      ]);
      await db.query("select public.delete_message($1)", [deleted]);
      await assert.rejects(() =>
        db.query("select public.send_reply($1,gen_random_uuid(),'Bad',$2)", [
          room,
          deleted,
        ]),
      );
    },
  );
  await check(
    "Reaction changes are idempotent and limited to allowed emoji",
    async () => {
      await db.query("select public.set_message_reaction($1,'❤️',true)", [
        original,
      ]);
      await db.query("select public.set_message_reaction($1,'❤️',true)", [
        original,
      ]);
      assert.equal((await extras()).reactions.length, 1);
      await assert.rejects(() =>
        db.query("select public.set_message_reaction($1,'<script>',true)", [
          original,
        ]),
      );
    },
  );
  await as(B);
  await check("Each member controls only their own reactions", async () => {
    await db.query("select public.set_message_reaction($1,'❤️',true)", [
      original,
    ]);
    assert.equal((await extras()).reactions.length, 2);
    await db.query("select public.set_message_reaction($1,'❤️',false)", [
      original,
    ]);
    assert.equal((await extras()).reactions[0].user_id, A);
    await assert.rejects(() =>
      db.query("delete from public.message_reactions where user_id=$1", [A]),
    );
  });
  await check(
    "Either DM member can pin and unpin the shared message",
    async () => {
      await db.query("select public.set_message_pin($1,true)", [original]);
      await db.query("select public.set_message_pin($1,true)", [original]);
      assert.equal((await extras()).pins.length, 1);
      await db.query("select public.set_message_pin($1,false)", [original]);
      assert.equal((await extras()).pins.length, 0);
    },
  );
  await as(A);
  await check(
    "Mute and archive persist without modifying other members or message history",
    async () => {
      await db.query(
        "select public.set_conversation_preferences($1,true,true)",
        [room],
      );
      const c = (await value("select public.list_conversations() v")).find(
        (c) => c.id === room,
      );
      assert.equal(c.muted, true);
      assert.equal(c.archived, true);
      assert.equal(
        Number(
          await value("select count(*) v from public.message_history($1)", [
            room,
          ]),
        ) > 0,
        true,
      );
      await as(B);
      const theirs = (await value("select public.list_conversations() v")).find(
        (c) => c.id === room,
      );
      assert.equal(theirs.muted, false);
      assert.equal(theirs.archived, false);
      assert.equal(
        Number(
          await value("select count(*) v from public.conversation_preferences"),
        ),
        0,
      );
      await as(A);
      await db.query(
        "select public.set_conversation_preferences($1,false,false)",
        [room],
      );
      const restored = (
        await value("select public.list_conversations() v")
      ).find((c) => c.id === room);
      assert.equal(restored.archived, false);
      assert.equal(restored.muted, false);
    },
  );
  await as(C);
  await check(
    "Outsiders cannot inspect or change replies, reactions, pins, or preferences",
    async () => {
      for (const [sql, args] of [
        [
          "select public.send_reply($1,gen_random_uuid(),'Bad',$2)",
          [room, original],
        ],
        ["select public.set_message_reaction($1,'👍',true)", [original]],
        ["select public.set_message_pin($1,true)", [original]],
        ["select public.set_conversation_preferences($1,true,true)", [room]],
        ["select public.chat_features($1,$2::uuid[])", [room, [original]]],
      ])
        await assert.rejects(() => db.query(sql, args));
      assert.equal(
        Number(
          await value(
            "select count(*) v from public.message_reactions where message_id=$1",
            [original],
          ),
        ),
        0,
      );
    },
  );
  await as(A);
  const group = await value(
    "select public.start_conversation($1::uuid[],'Pin permissions') v",
    [[B]],
  );
  await as(B);
  const invitation = await value(
    "select id v from public.group_invitations where conversation_id=$1 and invitee=$2",
    [group, B],
  );
  await db.query("select public.respond_group_invitation($1,true)", [
    invitation,
  ]);
  const groupMsg = "30000000-0000-4000-8000-000000000004";
  await db.query("select public.send_message($1,$2,'Group note')", [
    group,
    groupMsg,
  ]);
  await check(
    "Group pinning requires owner or admin and removal revokes all feature access",
    async () => {
      await assert.rejects(() =>
        db.query("select public.set_message_pin($1,true)", [groupMsg]),
      );
      await as(A);
      await db.query("select public.manage_group($1,$2,'promote')", [group, B]);
      await as(B);
      await db.query("select public.set_message_pin($1,true)", [groupMsg]);
      await as(A);
      await db.query("select public.manage_group($1,$2,'remove')", [group, B]);
      await as(B);
      await assert.rejects(() =>
        db.query("select public.chat_features($1,$2::uuid[])", [
          group,
          [groupMsg],
        ]),
      );
      await assert.rejects(() =>
        db.query("select public.set_message_pin($1,false)", [groupMsg]),
      );
    },
  );
  await as(A);
  await check(
    "Pin capacity is enforced and unpinning frees a slot",
    async () => {
      const ids = [];
      for (let i = 0; i < 20; i++) {
        const id = await value(
          "select (public.send_message($1,gen_random_uuid(),'Pin test')).id v",
          [room],
        );
        ids.push(id);
        await db.query("select public.set_message_pin($1,true)", [id]);
      }
      await assert.rejects(() =>
        db.query("select public.set_message_pin($1,true)", [original]),
      );
      await db.query("select public.set_message_pin($1,false)", [ids[0]]);
      await db.query("select public.set_message_pin($1,true)", [original]);
      assert.equal((await extras()).pins.length, 20);
    },
  );
  await check(
    "Deleted messages lose pins and reactions and reply quotes hide deleted content",
    async () => {
      await db.query("select public.delete_message($1)", [original]);
      const f = await extras();
      assert.equal(f.reactions.length, 0);
      assert.equal(
        f.pins.some((m) => m.id === original),
        false,
      );
      assert.equal(f.replies[0].body, "Message deleted");
      assert.equal(f.replies[0].attachment, null);
      await assert.rejects(() =>
        db.query("select public.set_message_reaction($1,'👍',true)", [
          original,
        ]),
      );
      await assert.rejects(() =>
        db.query("select public.set_message_pin($1,true)", [original]),
      );
    },
  );
  await check(
    "File messages can reply and retry without duplicate attachments",
    async () => {
      const path = `${room}/${A}/40000000-0000-4000-8000-000000000001`,
        id = "40000000-0000-4000-8000-000000000002";
      await db.query(
        "insert into storage.objects(bucket_id,name,metadata) values('chat-files',$1,$2)",
        [path, JSON.stringify({ size: 42, mimetype: "image/png" })],
      );
      const send = () =>
        value(
          "select to_jsonb(public.send_reply_attachment($1,$2,$3,'reply.png','Picture',$4)) v",
          [room, id, path, reply],
        );
      const m = await send();
      assert.equal(m.reply_to, reply);
      assert.equal(m.attachment.name, "reply.png");
      assert.deepEqual(await send(), m);
    },
  );
  await as(null);
  await check("Unauthenticated callers cannot use chat tools", async () => {
    await assert.rejects(() =>
      db.query("select public.chat_features($1,$2::uuid[])", [room, []]),
    );
    await assert.rejects(() =>
      db.query("select public.set_conversation_preferences($1,true,true)", [
        room,
      ]),
    );
  });
}
