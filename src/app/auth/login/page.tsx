"use client";
import { useState } from "react";
import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/auth?action=login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "登录失败");
      localStorage.setItem("token", data.token);
      window.location.assign("/");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "登录失败");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-white">
      {/* 顶部 Logo */}
      <header className="px-6 sm:px-10 py-4">
        <div className="text-sm font-medium text-slate-800">Your Logo</div>
      </header>
      {/* 内容区域：两栏布局 */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-8 px-6 sm:px-10">
        {/* 左侧表单 */}
        <div className="flex items-center justify-center order-2 lg:order-1">
          <div className="w-full max-w-lg">
            <Card className="border rounded-[12px]">
              <CardHeader>
                <CardTitle className="text-2xl">Sign in to</CardTitle>
                <CardDescription>Lorem Ipsum is simply</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                {error && (
                  <div className="text-sm border border-red-200 bg-red-50 text-red-700 rounded-md px-3 py-2">{error}</div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="email">User name</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your user name" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input id="password" type={showPwd ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your Password" />
                    <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute inset-y-0 right-2 my-auto h-8 px-2 rounded-md text-xs text-muted-foreground hover:bg-accent">
                      {showPwd ? "🙈" : "👁️"}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <label className="inline-flex items-center gap-2 select-none">
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300" />
                    Remember me
                  </label>
                  <a href="#" className="hover:underline">Forgot Password ?</a>
                </div>
              </CardContent>
              <CardFooter className="flex-col items-stretch gap-3">
                <Button onClick={submit} disabled={loading} className="w-full h-11 text-base">Login</Button>
                <p className="text-sm text-center text-muted-foreground">
                  Don’t have an Account ? <a href="/auth/register" className="text-primary hover:underline">Register</a>
                </p>
              </CardFooter>
            </Card>
          </div>
        </div>

        {/* 右侧插画 */}
        <div className="hidden lg:flex items-center justify-center order-1 lg:order-2">
          <div className="max-w-[560px] w-full">
            <Image src="/assets/login.svg" alt="Login Illustration" width={1120} height={800} priority className="w-full h-auto" />
          </div>
        </div>
      </main>
    </div>
  );
}


