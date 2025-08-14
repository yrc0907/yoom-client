"use client";
import { useState } from "react";
import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit() {
    setLoading(true); setError(null); setOk(false);
    try {
      const res = await fetch("/api/auth?action=register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "注册失败");
      setOk(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "注册失败");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-white">
      <header className="px-6 sm:px-10 py-4">
        <div className="text-sm font-medium text-slate-800">Your Logo</div>
      </header>
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-8 px-6 sm:px-10">
        {/* 左侧表单 */}
        <div className="flex items-center justify-center order-2 lg:order-1">
          <div className="w-full max-w-lg">
            <Card className="border rounded-[12px]">
              <CardHeader>
                <CardTitle className="text-2xl">Sign up to</CardTitle>
                <CardDescription>Lorem Ipsum is simply</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                {error && (
                  <div className="text-sm border border-red-200 bg-red-50 text-red-700 rounded-md px-3 py-2">{error}</div>
                )}
                {ok && (
                  <div className="text-sm border border-green-200 bg-green-50 text-green-700 rounded-md px-3 py-2">注册成功，去登录吧！</div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" />
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
              </CardContent>
              <CardFooter className="flex-col items-stretch gap-3">
                <Button onClick={submit} disabled={loading} className="w-full h-11 text-base">Register</Button>
                <p className="text-sm text-center text-muted-foreground">
                  Already have an Account ? <a href="/auth/login" className="text-primary hover:underline">Register</a>
                </p>
              </CardFooter>
            </Card>
          </div>
        </div>
        {/* 右侧插画 */}
        <div className="hidden lg:flex items-center justify-center order-1 lg:order-2">
          <div className="max-w-[560px] w-full">
            <Image src="/assets/login.svg" alt="Register Illustration" width={1120} height={800} priority className="w-full h-auto" />
          </div>
        </div>
      </main>
    </div>
  );
}


