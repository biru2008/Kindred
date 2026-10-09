import assert from "node:assert/strict";
export async function testDiscovery(db, { A, B, C, as, value, check }) {
  await db.exec("reset role");
  const U = "00000000-0000-4000-8000-000000000099";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data,email) values($1,'{}','unconfirmed@example.com')",
    [U],
  );
  await check("Accounts require an email address", async () => {
    await assert.rejects(
      () =>
        db.query(
          "insert into auth.users(id,raw_user_meta_data) values('00000000-0000-4000-8000-000000000098','{}')",
        ),
      /email address is required/,
    );
  });
  await check(
    "The Auth email uniqueness constraint rejects case variants",
    async () => {
      await assert.rejects(
        () =>
          db.query(
            "insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values('00000000-0000-4000-8000-000000000097','{}','UNCONFIRMED@example.com',now())",
          ),
        /unique/,
      );
    },
  );
  await as(U);
  await check(
    "Email signup generates a profile without requiring profile metadata",
    async () => {
      await db.exec("reset role");
      assert.ok(
        await value("select username v from public.profiles where id=$1", [U]),
      );
      await as(U);
    },
  );
  await check(
    "Unverified accounts cannot access directory, chat creation, or matching",
    async () => {
      assert.equal(
        Number(await value("select count(*) v from public.profiles")),
        0,
      );
      await assert.rejects(() =>
        db.query("select public.start_conversation($1::uuid[])", [[A]]),
      );
      await assert.rejects(() => db.query("select public.join_random(true)"));
      assert.equal(
        (await value("select public.account_status() v")).email_verified,
        false,
      );
    },
  );
  await as(A);
  await check(
    "Anonymous profile is stored separately from the public directory",
    async () => {
      await db.query("select public.save_persona($1,$2,$3,$4)", [
        true,
        "Hidden Aurora",
        "Space, vinyl, and rainy walks.",
        "lavender",
      ]);
      const p = await value("select public.my_personas() v");
      assert.equal(p.anonymous.display_name, "Hidden Aurora");
      assert.equal(p.normal.display_name, "Alex Updated");
      assert.equal(
        Number(
          await value(
            "select count(*) v from public.profiles where display_name='Hidden Aurora'",
          ),
        ),
        0,
      );
    },
  );
  await check(
    "Private ratings and identity mappings have no client table access",
    async () => {
      for (const table of [
        "personas",
        "random_members",
        "match_queue",
        "conversation_ratings",
        "blocks",
      ])
        await assert.rejects(() => db.query(`select * from private.${table}`));
      await assert.rejects(() =>
        db.query("select private.match_score($1)", [B]),
      );
    },
  );
  await check(
    "First caller waits instead of inventing a remote person",
    async () =>
      assert.equal(
        (await value("select public.join_random(true) v")).status,
        "waiting",
      ),
  );
  await as(B);
  const b = await value("select public.join_random(false) v");
  const session = b.session_id;
  await check("Second caller receives a single atomic match", async () => {
    assert.equal(b.status, "matched");
    assert.equal(b.peer.display_name, "Hidden Aurora");
    assert.equal(b.peer.anonymous, true);
    assert.notEqual(b.peer.id, A);
    assert.ok(!JSON.stringify(b).includes(A));
    assert.equal(b.peer.username, undefined);
    assert.equal(b.peer.phone, undefined);
    assert.equal(b.peer.email, undefined);
  });
  await as(A);
  const a = await value("select public.random_state() v");
  await check(
    "Each peer sees only the selected identity and per-session IDs",
    async () => {
      assert.equal(a.session_id, session);
      assert.equal(a.peer.anonymous, false);
      assert.equal(a.peer.display_name, "maya");
      assert.notEqual(a.self_id, A);
      assert.notEqual(a.peer.id, B);
      assert.ok(!JSON.stringify(a).includes(B));
    },
  );
  await check(
    "Repeated join cannot create a second simultaneous match",
    async () =>
      assert.equal(
        (await value("select public.join_random(false) v")).session_id,
        session,
      ),
  );
  const id = crypto.randomUUID();
  await check(
    "Anonymous messages are persisted and retries are idempotent",
    async () => {
      await db.query("select public.send_random($1,$2,$3)", [
        session,
        id,
        "Hello without revealing my account",
      ]);
      await db.query("select public.send_random($1,$2,$3)", [
        session,
        id,
        "Hello without revealing my account",
      ]);
      const history = await value("select public.random_history($1) v", [
        session,
      ]);
      assert.equal(history.length, 1);
      assert.equal(history[0].sender_id, a.self_id);
      assert.ok(!JSON.stringify(history).includes(A));
    },
  );
  await check("Active conversations cannot be rated prematurely", async () =>
    assert.rejects(() =>
      db.query("select public.rate_random($1,5,false)", [session]),
    ),
  );
  await as(C);
  await check(
    "Outsider cannot fetch, end, rate, or send to a random session",
    async () => {
      for (const [sql, args] of [
        ["select public.random_history($1)", [session]],
        ["select public.end_random($1)", [session]],
        ["select public.rate_random($1,1,false)", [session]],
        [
          "select public.send_random($1,$2,$3)",
          [session, crypto.randomUUID(), "spoof"],
        ],
      ])
        await assert.rejects(() => db.query(sql, args));
    },
  );
  await as(A);
  await db.query("select public.end_random($1)", [session]);
  await check("Ended conversations reject further messages", async () =>
    assert.rejects(() =>
      db.query("select public.send_random($1,$2,$3)", [
        session,
        crypto.randomUUID(),
        "too late",
      ]),
    ),
  );
  await check(
    "Rating is private and accepted only once per participant",
    async () => {
      await db.query("select public.rate_random($1,5,true)", [session]);
      await assert.rejects(() =>
        db.query("select public.rate_random($1,1,false)", [session]),
      );
      assert.deepEqual(await value("select public.random_state() v"), {
        status: "idle",
      });
    },
  );
  await as(B);
  await check(
    "The rated user cannot retrieve their received score",
    async () => {
      const state = await value("select public.random_state() v");
      assert.equal(state.status, "ended");
      assert.equal(state.rating, undefined);
      assert.equal(state.score, undefined);
      await assert.rejects(() =>
        db.query("select * from private.conversation_ratings"),
      );
      await db.query("select public.rate_random($1,null,false)", [session]);
    },
  );
  await as(A);
  await db.query("select public.join_random(true)");
  await as(B);
  await check("Blocked or recently paired users are not rematched", async () =>
    assert.equal(
      (await value("select public.join_random(true) v")).status,
      "waiting",
    ),
  );
  await db.exec("reset role");
  await check(
    "Private feedback changes reputation without one vote defining it",
    async () => {
      const score = Number(
        await value("select private.match_score($1) v", [B]),
      );
      assert.ok(score > 3.5 && score < 4);
      assert.equal(await value("select private.match_band($1) v", [B]), 0);
    },
  );
  // Exercise the matching policy using distinct verified raters, not client-supplied reputation.
  const raters = Array.from(
    { length: 6 },
    (_, i) => `00000000-0000-4000-8000-${String(100 + i).padStart(12, "0")}`,
  );
  for (const r of raters) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values($1::uuid,'{}',$1::text||'@example.com',now())",
      [r],
    );
    await db.query(
      "insert into private.conversation_ratings(session_id,rater,target,score) values($1,$2,$3,1)",
      [session, r, B],
    );
  }
  await check(
    "Sustained poor feedback moves a user to a separate matching band",
    async () =>
      assert.equal(await value("select private.match_band($1) v", [B]), 1),
  );
  await db.exec("delete from private.match_queue");
  await as(B);
  await db.query("select public.join_random(true)");
  await as(C);
  await check(
    "Matching does not mix the low-feedback band with the default band",
    async () =>
      assert.equal(
        (await value("select public.join_random(true) v")).status,
        "waiting",
      ),
  );
  await db.exec("reset role");
  await db.exec("delete from private.match_queue");
  await as(C);
  await db.query("select public.join_random(true)");
  await db.exec("reset role");
  await db.query(
    "update private.match_queue set heartbeat_at=now()-interval '2 minutes' where user_id=$1",
    [C],
  );
  await as(A);
  await check("Stale queue entries do not produce ghost matches", async () =>
    assert.equal(
      (await value("select public.join_random(true) v")).status,
      "waiting",
    ),
  );
  await db.query("select public.cancel_random()");
  await check("Cancel search removes the caller from the queue", async () =>
    assert.equal(
      (await value("select public.random_state() v")).status,
      "idle",
    ),
  );
  await db.exec("reset role");
  const file = `${crypto.randomUUID()}.mp3`;
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id) values('profile-music',$1,$2)",
    [file, A],
  );
  await as(B);
  await check(
    "A song cannot be assigned from another user’s private upload metadata",
    async () =>
      assert.rejects(() =>
        db.query("select public.save_persona($1,$2,$3,$4,$5,$6)", [
          true,
          "Someone",
          "Hi",
          "blue",
          file,
          "stolen",
        ]),
      ),
  );
  await as(A);
  await db.query("select public.save_persona($1,$2,$3,$4,$5,$6)", [
    true,
    "Hidden Aurora",
    "Hi",
    "lavender",
    file,
    "Night walk",
  ]);
  await check(
    "Regular and anonymous profiles cannot share a traceable audio URL",
    async () =>
      assert.rejects(() =>
        db.query("select public.save_persona($1,$2,$3,$4,$5,$6)", [
          false,
          "Alex",
          "Hi",
          "fern",
          file,
          "Night walk",
        ]),
      ),
  );
  await as(null);
  await check(
    "Anonymous unauthenticated callers cannot join or read persona settings",
    async () => {
      await assert.rejects(() => db.query("select public.join_random(true)"));
      await assert.rejects(() => db.query("select public.my_personas()"));
    },
  );
}
