async function fetchUser(id: string) {
  const base = process.env.NEXT_PUBLIC_APP_ORIGIN || "";
  const u = new URL(`/api/users/${encodeURIComponent(id)}`, base || "http://localhost:3000");
  const res = await fetch(u.toString(), { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export default async function Page({ params }: { params: { id: string } }) {
  const id = decodeURIComponent(params.id);
  const user = await fetchUser(id);
  if (!user) return <div style={{ padding: 24 }}>用户不存在</div>;
  return (
    <div style={{ padding: 24, maxWidth: 720, display: 'grid', gap: 12 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>用户详情</h1>
      <div style={{ padding: 12, border: '1px solid #eee', borderRadius: 8 }}>
        <div><b>ID：</b>{user.id}</div>
        <div><b>邮箱：</b>{user.email}</div>
        <div><b>注册时间：</b>{new Date(user.createdAt).toLocaleString()}</div>
      </div>
    </div>
  );
}


