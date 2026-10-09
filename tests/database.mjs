import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(`
 create role anon; create role authenticated;
 create schema auth;
 create table auth.users(id uuid primary key, raw_user_meta_data jsonb, email text, email_confirmed_at timestamptz);
 create unique index auth_users_email_unique on auth.users(lower(email));
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
 grant usage on schema auth to authenticated, anon;
 create schema realtime; create table realtime.messages(id bigint generated always as identity, extension text);
 alter table realtime.messages enable row level security;
 create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
 grant usage on schema realtime to authenticated;
 grant select,insert on realtime.messages to authenticated;
 create publication supabase_realtime;
 create function realtime.send(payload jsonb,event text,topic text,private boolean default true) returns void language plpgsql as $$ begin insert into realtime.messages(extension) values('broadcast'); end $$;
 create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb);
 alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated;
 grant select,insert,delete on storage.objects to authenticated;
`);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/001_kindred.sql", import.meta.url),
    "utf8",
  ),
);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/002_discover.sql", import.meta.url),
    "utf8",
  ),
);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/003_interests.sql", import.meta.url),
    "utf8",
  ),
);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/004_custom_interests.sql", import.meta.url),
    "utf8",
  ),
);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/005_group_management.sql", import.meta.url),
    "utf8",
  ),
);
const A = "00000000-0000-4000-8000-000000000001",
  B = "00000000-0000-4000-8000-000000000002",
  C = "00000000-0000-4000-8000-000000000003";
for (const [id, name] of [
  [A, "alex"],
  [B, "maya"],
  [C, "outsider"],
])
  await db.query(
    `insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values($1::uuid,$2,$1::text||'@example.com',now())`,
    [id, JSON.stringify({ username: name, display_name: name })],
  );
let checks = 0;
async function check(name, fn) {
  await fn();
  checks++;
  console.log(`PASS ${name}`);
}
async function as(id) {
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [
    id || "",
  ]);
  await db.exec(`set role ${id ? "authenticated" : "anon"}`);
}
async function value(sql, args = []) {
  return (await db.query(sql, args)).rows[0].v;
}
await as(A);
const conversation = await value(
  "select public.start_conversation($1::uuid[]) v",
  [[B]],
);
await check("New direct chat has exactly two members", async () =>
  assert.equal(
    Number(await value("select count(*) v from public.conversation_members")),
    2,
  ),
);
await as(B);
await check(
  "Reverse-order direct chat reuses the same conversation",
  async () =>
    assert.equal(
      await value("select public.start_conversation($1::uuid[]) v", [[A]]),
      conversation,
    ),
);
await as(A);
const msg = "10000000-0000-4000-8000-000000000001";
await check("Sender comes from the authenticated identity", async () => {
  const m = await value("select to_jsonb(public.send_message($1,$2,$3)) v", [
    conversation,
    msg,
    " Hello Maya ",
  ]);
  assert.equal(m.sender_id, A);
  assert.equal(m.body, "Hello Maya");
});
await check("Retries do not create duplicate messages", async () => {
  await value("select public.send_message($1,$2,$3) v", [
    conversation,
    msg,
    "Hello Maya",
  ]);
  assert.equal(
    Number(await value("select count(*) v from public.messages")),
    1,
  );
});
await check("Retry cannot silently overwrite a prior message", async () =>
  assert.rejects(() =>
    db.query("select public.send_message($1,$2,$3)", [
      conversation,
      msg,
      "Changed",
    ]),
  ),
);
await check("Blank and null messages are rejected", async () => {
  for (const body of ["   ", null, "x".repeat(4001)])
    await assert.rejects(() =>
      db.query("select public.send_message($1,$2,$3)", [
        conversation,
        crypto.randomUUID(),
        body,
      ]),
    );
});
await check("Direct writes cannot spoof sender or membership", async () => {
  await assert.rejects(() =>
    db.query(
      "insert into public.messages(id,conversation_id,sender_id,body) values($1,$2,$3,$4)",
      [crypto.randomUUID(), conversation, B, "spoof"],
    ),
  );
  await assert.rejects(() =>
    db.query(
      "insert into public.conversation_members(conversation_id,user_id) values($1,$2)",
      [conversation, C],
    ),
  );
});
await as(C);
await check(
  "Outsider cannot read conversation, members, or messages",
  async () => {
    for (const table of ["conversations", "conversation_members", "messages"])
      assert.equal(
        Number(await value(`select count(*) v from public.${table}`)),
        0,
      );
  },
);
await check("Outsider history and search are empty", async () => {
  assert.equal(
    (await db.query("select * from public.message_history($1)", [conversation]))
      .rows.length,
    0,
  );
  assert.equal(
    (
      await db.query("select * from public.search_messages($1,$2)", [
        conversation,
        "Hello",
      ])
    ).rows.length,
    0,
  );
});
await check(
  "Outsider cannot send, edit, delete, or mark private messages read",
  async () => {
    for (const [sql, args] of [
      [
        "select public.send_message($1,$2,$3)",
        [conversation, crypto.randomUUID(), "bad"],
      ],
      ["select public.edit_message($1,$2)", [msg, "bad"]],
      ["select public.delete_message($1)", [msg]],
      ["select public.mark_read($1,now())", [conversation]],
    ])
      await assert.rejects(() => db.query(sql, args));
  },
);
await as(B);
await check("Member sees persistent history with correct sender", async () => {
  const { rows } = await db.query("select * from public.message_history($1)", [
    conversation,
  ]);
  assert.equal(rows[0].body, "Hello Maya");
  assert.equal(rows[0].sender_id, A);
});
await check("Only original sender may edit or delete", async () => {
  await assert.rejects(() =>
    db.query("select public.edit_message($1,$2)", [msg, "bad"]),
  );
  await assert.rejects(() =>
    db.query("select public.delete_message($1)", [msg]),
  );
});
await check("Read receipts advance and never move backward", async () => {
  await db.query("select public.mark_read($1,now())", [conversation]);
  const date = await value(
    "select last_read_at v from public.conversation_members where user_id=$1",
    [B],
  );
  await db.query("select public.mark_read($1,'2000-01-01'::timestamptz)", [
    conversation,
  ]);
  assert.deepEqual(
    await value(
      "select last_read_at v from public.conversation_members where user_id=$1",
      [B],
    ),
    date,
  );
  await assert.rejects(() =>
    db.query("select public.mark_read($1,null)", [conversation]),
  );
});
await check("Read marker clears unread counter", async () => {
  const data = await value("select public.list_conversations() v");
  assert.equal(data[0].unread, 0);
});
await as(A);
await check("History validates a complete pagination cursor", async () => {
  await assert.rejects(() =>
    db.query("select * from public.message_history($1,now(),null)", [
      conversation,
    ]),
  );
});
await check("Search treats wildcard characters literally", async () =>
  assert.equal(
    (
      await db.query("select * from public.search_messages($1,$2)", [
        conversation,
        "%%",
      ])
    ).rows.length,
    0,
  ),
);
await check("Edit and soft delete persist", async () => {
  await db.query("select public.edit_message($1,$2)", [msg, "Updated hello"]);
  assert.equal(
    await value("select body v from public.messages where id=$1", [msg]),
    "Updated hello",
  );
  await db.query("select public.delete_message($1)", [msg]);
  assert.equal(
    await value("select body v from public.messages where id=$1", [msg]),
    "Message deleted",
  );
  assert.equal(
    (
      await db.query("select * from public.search_messages($1,$2)", [
        conversation,
        "Updated",
      ])
    ).rows.length,
    0,
  );
});
await check(
  "Group creation creates the owner and invitations, without adding recipients",
  async () => {
    const group = await value("select public.start_conversation($1,$2) v", [
      [B, C],
      "Weekend",
    ]);
    assert.equal(
      Number(
        await value(
          "select count(*) v from public.conversation_members where conversation_id=$1",
          [group],
        ),
      ),
      1,
    );
  },
);
await check(
  "Invalid group/member data cannot create partial conversations",
  async () => {
    const before = await value("select count(*) v from public.conversations");
    await assert.rejects(() =>
      db.query("select public.start_conversation($1,$2)", [
        [crypto.randomUUID()],
        "Ghosts",
      ]),
    );
    await assert.rejects(() =>
      db.query("select public.start_conversation($1,$2)", [[B], " "]),
    );
    assert.equal(
      await value("select count(*) v from public.conversations"),
      before,
    );
  },
);
await check("Profile updates cannot target another identity", async () => {
  await db.query("select public.update_profile($1,$2,$3)", [
    "Alex Updated",
    "Hi!",
    "blue",
  ]);
  assert.equal(
    await value("select display_name v from public.profiles where id=$1", [A]),
    "Alex Updated",
  );
  assert.equal(
    await value("select display_name v from public.profiles where id=$1", [B]),
    "maya",
  );
});
await check("Private conversation channel allows member presence", async () => {
  await db.query("select set_config('realtime.topic',$1,false)", [
    `conversation:${conversation}`,
  ]);
  await db.query("insert into realtime.messages(extension) values('presence')");
});
await as(C);
await check("Private channel rejects outsider typing broadcasts", async () => {
  await db.query("select set_config('realtime.topic',$1,false)", [
    `conversation:${conversation}`,
  ]);
  await assert.rejects(() =>
    db.query("insert into realtime.messages(extension) values('broadcast')"),
  );
  assert.equal(
    Number(await value("select count(*) v from realtime.messages")),
    0,
  );
});
await as(null);
await check(
  "Anonymous clients cannot read data or call mutation RPCs",
  async () => {
    await assert.rejects(() => db.query("select * from public.profiles"));
    await assert.rejects(() =>
      db.query("select public.start_conversation($1::uuid[])", [[A]]),
    );
  },
);
console.log(
  `\n${checks} database checks passed. PGlite verifies PostgreSQL schema/RLS/RPCs; it does not emulate Supabase Auth or WebSocket delivery.`,
);
const { testDiscovery } = await import("./discovery-checks.mjs");
await testDiscovery(db, { A, B, C, as, value, check });
const { testInterests } = await import("./interests-checks.mjs");
await testInterests(db, { as, value, check });
const { testCustomInterests } = await import("./custom-interests-checks.mjs");
await testCustomInterests(db, { as, value, check });
const { testGroups } = await import("./group-checks.mjs");
await testGroups(db, { A, B, C, as, value, check });
const { testAttachments } = await import("./attachment-checks.mjs");
await testAttachments(db, { A, B, C, as, value, check });
const { testChatTools } = await import("./chat-tools-checks.mjs");
await testChatTools(db, { A, B, C, as, value, check });
const { testDiscoveryExperience } = await import(
  "./discovery-experience-checks.mjs"
);
await testDiscoveryExperience(db, { C, as, value, check });
console.log(`Total: ${checks} database checks passed.`);
await db.close();
