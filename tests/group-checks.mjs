import assert from "node:assert/strict";
export async function testGroups(db, { A, B, C, as, value, check }) {
  await as(A);
  const cid = await value("select public.start_conversation($1,$2) v", [
    [B, C],
    "Managed circle",
  ]);
  let invitations = await value("select public.list_group_invitations() v");
  const bi = invitations.find(
    (i) => i.conversation_id === cid && i.invitee === B,
  ).id;
  const ci = invitations.find(
    (i) => i.conversation_id === cid && i.invitee === C,
  ).id;
  await check(
    "Group creator is the sole owner; recipients remain outside until accepting",
    async () => {
      const c = (await value("select public.list_conversations() v")).find(
        (c) => c.id === cid,
      );
      assert.equal(c.members.length, 1);
      assert.equal(c.members[0].role, "owner");
    },
  );
  await as(B);
  await check(
    "Invited recipient cannot read the group before accepting",
    async () => {
      assert.equal(
        Number(
          await value(
            "select count(*) v from public.conversations where id=$1",
            [cid],
          ),
        ),
        0,
      );
      await assert.rejects(() =>
        db.query("select public.send_message($1,gen_random_uuid(),$2)", [
          cid,
          "not yet",
        ]),
      );
      assert.ok(
        (await value("select public.list_group_invitations() v")).some(
          (i) => i.id === bi,
        ),
      );
    },
  );
  await check(
    "Recipients cannot respond to someone else’s invitation",
    async () => {
      await assert.rejects(() =>
        db.query("select public.respond_group_invitation($1,true)", [ci]),
      );
    },
  );
  await check("Accepting creates membership exactly once", async () => {
    await db.query("select public.respond_group_invitation($1,true)", [bi]);
    assert.ok(
      (await value("select public.list_conversations() v")).some(
        (c) => c.id === cid,
      ),
    );
    await assert.rejects(() =>
      db.query("select public.respond_group_invitation($1,true)", [bi]),
    );
  });
  await check(
    "Regular members cannot invite, promote themselves, or remove the owner",
    async () => {
      for (const action of ["promote", "transfer", "remove"])
        await assert.rejects(() =>
          db.query("select public.manage_group($1,$2,$3)", [
            cid,
            action === "remove" ? A : B,
            action,
          ]),
        );
      await assert.rejects(() =>
        db.query("select public.invite_group($1,$2)", [cid, C]),
      );
    },
  );
  await as(C);
  await check("Declining keeps the recipient outside", async () => {
    await db.query("select public.respond_group_invitation($1,false)", [ci]);
    assert.equal(
      Number(
        await value("select count(*) v from public.conversations where id=$1", [
          cid,
        ]),
      ),
      0,
    );
  });
  await as(A);
  await check(
    "Owner can appoint an admin but cannot leave without transfer",
    async () => {
      await db.query("select public.manage_group($1,$2,$3)", [
        cid,
        B,
        "promote",
      ]);
      await assert.rejects(() =>
        db.query("select public.manage_group($1,$2,$3)", [cid, A, "leave"]),
      );
    },
  );
  await as(B);
  await check(
    "Admin can invite but cannot change roles or remove the owner",
    async () => {
      await db.query("select public.invite_group($1,$2)", [cid, C]);
      await assert.rejects(() =>
        db.query("select public.manage_group($1,$2,$3)", [cid, A, "remove"]),
      );
      await assert.rejects(() =>
        db.query("select public.manage_group($1,$2,$3)", [cid, B, "demote"]),
      );
    },
  );
  await as(C);
  const ci2 = (await value("select public.list_group_invitations() v")).find(
    (i) => i.conversation_id === cid,
  ).id;
  await db.query("select public.respond_group_invitation($1,true)", [ci2]);
  await as(B);
  await check(
    "Removing a member revokes database access immediately",
    async () => {
      await db.query("select public.manage_group($1,$2,$3)", [
        cid,
        C,
        "remove",
      ]);
      await as(C);
      assert.equal(
        Number(
          await value(
            "select count(*) v from public.conversation_members where conversation_id=$1",
            [cid],
          ),
        ),
        0,
      );
      await assert.rejects(() =>
        db.query("select public.send_message($1,gen_random_uuid(),$2)", [
          cid,
          "blocked",
        ]),
      );
      await assert.rejects(() =>
        db.query("select public.manage_group($1,$2,$3)", [cid, B, "remove"]),
      );
    },
  );
  await as(A);
  await check(
    "Owner can demote admins and transfer ownership atomically",
    async () => {
      await db.query("select public.manage_group($1,$2,$3)", [
        cid,
        B,
        "demote",
      ]);
      await db.query("select public.manage_group($1,$2,$3)", [
        cid,
        B,
        "transfer",
      ]);
      const c = (await value("select public.list_conversations() v")).find(
        (c) => c.id === cid,
      );
      assert.equal(c.members.filter((m) => m.role === "owner").length, 1);
      assert.equal(c.members.find((m) => m.id === B).role, "owner");
      assert.equal(c.members.find((m) => m.id === A).role, "admin");
    },
  );
  await check(
    "An admin can revoke an invitation and recipient cannot accept it",
    async () => {
      await db.query("select public.invite_group($1,$2)", [cid, C]);
      const i = (await value("select public.list_group_invitations() v")).find(
        (i) => i.conversation_id === cid && i.invitee === C,
      ).id;
      await db.query("select public.manage_group($1,$2,$3)", [
        cid,
        C,
        "revoke",
      ]);
      await as(C);
      await assert.rejects(() =>
        db.query("select public.respond_group_invitation($1,true)", [i]),
      );
    },
  );
  await as(A);
  await check(
    "Members can leave, and direct messages do not accept group actions",
    async () => {
      await db.query("select public.manage_group($1,$2,$3)", [cid, A, "leave"]);
      assert.equal(
        Number(
          await value(
            "select count(*) v from public.conversations where id=$1",
            [cid],
          ),
        ),
        0,
      );
      const direct = await value("select public.start_conversation($1) v", [
        [B],
      ]);
      await assert.rejects(() =>
        db.query("select public.manage_group($1,$2,$3)", [direct, B, "remove"]),
      );
    },
  );
  await as(B);
  await check(
    "Pending invitations reserve capacity and outsiders cannot inspect them",
    async () => {
      const people = [];
      await db.exec("reset role");
      for (let n = 901; n <= 920; n++) {
        const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
        await db.query(
          "insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values($1,'{}',$2,now())",
          [id, `capacity${n}@example.com`],
        );
        people.push(id);
      }
      await as(B);
      const full = await value("select public.start_conversation($1,$2) v", [
        people.slice(0, 19),
        "Capacity circle",
      ]);
      await assert.rejects(
        () => db.query("select public.invite_group($1,$2)", [full, people[19]]),
        /capacity/,
      );
      await as(people[19]);
      assert.equal(
        Number(
          await value(
            "select count(*) v from public.group_invitations where conversation_id=$1",
            [full],
          ),
        ),
        0,
      );
      assert.equal(
        (await value("select public.list_group_invitations() v")).filter(
          (i) => i.conversation_id === full,
        ).length,
        0,
      );
    },
  );
  await as(null);
  await check(
    "Unauthenticated users cannot call group-management RPCs",
    async () => {
      await assert.rejects(() =>
        db.query("select public.list_group_invitations()"),
      );
      await assert.rejects(() =>
        db.query("select public.invite_group($1,$2)", [cid, C]),
      );
    },
  );
}
