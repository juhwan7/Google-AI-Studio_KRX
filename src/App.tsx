import { useState, useEffect } from "react";
import { Send, Settings, AlertCircle, CheckCircle2, RefreshCw, BarChart3 } from "lucide-react";
import { motion } from "motion/react";

export default function App() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError("서버 연결에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const [testing, setTesting] = useState(false);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      const res = await fetch("/api/trigger", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        alert("성공: " + data.message);
      } else {
        alert("오류: " + data.error);
      }
      fetchStatus();
    } catch (err) {
      alert("수동 실행에 실패했습니다.");
    } finally {
      setTriggering(false);
    }
  };

  const handleTestTelegram = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/test-telegram", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        alert("테스트 메시지 발송 성공! 텔레그램을 확인하세요.");
      } else {
        alert("테스트 실패: " + (data.error?.description || data.error));
      }
    } catch (err) {
      alert("테스트 요청 중 오류가 발생했습니다.");
    } finally {
      setTesting(false);
    }
  };

  const isMarketOpen = () => {
    const now = new Date();
    const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const day = kst.getDay();
    const hours = kst.getHours();
    const minutes = kst.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    return day >= 1 && day <= 5 && totalMinutes >= 9 * 60 + 30 && totalMinutes <= 15 * 60 + 30;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-white">
        <RefreshCw className="animate-spin w-8 h-8 opacity-50" />
      </div>
    );
  }

  const latest = status?.latestSnapshot;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-black" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">K-Stock Bot Dashboard</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 text-xs font-medium px-3 py-1 rounded-full border ${isMarketOpen() ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' : 'text-white/40 bg-white/5 border-white/10'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${isMarketOpen() ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'}`}></div>
              {isMarketOpen() ? "장 운영 중" : "장 종료"}
            </div>
            {status?.botConfigured ? (
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full border border-emerald-400/20">
                <CheckCircle2 className="w-3.5 h-3.5" />
                봇 활성화됨
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs font-medium text-orange-400 bg-orange-400/10 px-3 py-1 rounded-full border border-orange-400/20">
                <AlertCircle className="w-3.5 h-3.5" />
                설정 필요
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Status Card */}
          <div className="lg:col-span-2 space-y-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/[0.03] border border-white/10 rounded-3xl p-8 overflow-hidden relative"
            >
              <div className="absolute top-0 right-0 p-8 opacity-10">
                <Send className="w-32 h-32 rotate-12" />
              </div>
              
              <div className="relative z-10">
                <h2 className="text-3xl font-light mb-4 tracking-tight">
                  실시간 수급 알림 봇
                </h2>
                <p className="text-white/50 text-lg mb-8 max-w-md leading-relaxed">
                  코스피와 코스닥의 개인, 외국인, 기관 수급 현황을 30분마다 분석하여 텔레그램으로 전송합니다.
                </p>

                <div className="flex flex-wrap gap-4">
                  <button 
                    onClick={handleTrigger}
                    disabled={triggering || !status?.botConfigured}
                    className="group relative px-6 py-3 bg-white text-black rounded-full font-semibold overflow-hidden transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
                  >
                    <span className="relative z-10 flex items-center gap-2">
                      {triggering ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      {isMarketOpen() ? "지금 즉시 전송하기" : "종가 데이터 전송하기"}
                    </span>
                  </button>

                  <button 
                    onClick={handleTestTelegram}
                    disabled={testing || !status?.botConfigured}
                    className="px-6 py-3 border border-orange-500/30 text-orange-400 rounded-full font-semibold hover:bg-orange-500/10 transition-all disabled:opacity-50"
                  >
                    <span className="flex items-center gap-2">
                      {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      텔레그램 연결 테스트
                    </span>
                  </button>
                  
                  <a 
                    href="https://t.me/botfather" 
                    target="_blank" 
                    rel="noreferrer"
                    className="px-6 py-3 border border-white/10 rounded-full font-semibold hover:bg-white/5 transition-all"
                  >
                    봇 생성하기 (BotFather)
                  </a>
                </div>
              </div>
            </motion.div>

            {/* Latest Data Preview */}
            {latest && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-white/[0.03] border border-white/10 rounded-3xl p-8"
              >
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-xl font-medium tracking-tight">최근 수집 데이터</h3>
                  <span className="text-xs text-white/40 font-mono">
                    {new Date(latest.timestamp).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (KST)
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* KOSPI */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-blue-400 uppercase tracking-widest">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
                      KOSPI
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white/5 rounded-xl p-4">
                        <div className="text-[10px] text-white/40 uppercase mb-1">개인</div>
                        <div className="text-lg font-mono">{(latest.kospi.individual / 100).toFixed(0)}<span className="text-xs ml-1 text-white/30">억</span></div>
                      </div>
                      <div className="bg-white/5 rounded-xl p-4">
                        <div className="text-[10px] text-white/40 uppercase mb-1">외국인</div>
                        <div className="text-lg font-mono">{(latest.kospi.foreign / 100).toFixed(0)}<span className="text-xs ml-1 text-white/30">억</span></div>
                      </div>
                      <div className="bg-white/5 rounded-xl p-4">
                        <div className="text-[10px] text-white/40 uppercase mb-1">기관</div>
                        <div className="text-lg font-mono">{(latest.kospi.institutional / 100).toFixed(0)}<span className="text-xs ml-1 text-white/30">억</span></div>
                      </div>
                      <div className="bg-white/5 rounded-xl p-4 border border-blue-500/20">
                        <div className="text-[10px] text-blue-400/60 uppercase mb-1">비차익</div>
                        <div className="text-lg font-mono">{(latest.kospi.program_non_arbitrage / 100).toFixed(0)}<span className="text-xs ml-1 text-white/30">억</span></div>
                      </div>
                    </div>
                  </div>

                  {/* KOSDAQ */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-orange-400 uppercase tracking-widest">
                      <div className="w-1.5 h-1.5 rounded-full bg-orange-400"></div>
                      KOSDAQ
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white/5 rounded-xl p-4">
                        <div className="text-[10px] text-white/40 uppercase mb-1">개인</div>
                        <div className="text-lg font-mono">{(latest.kosdaq.individual / 100).toFixed(0)}<span className="text-xs ml-1 text-white/30">억</span></div>
                      </div>
                      <div className="bg-white/5 rounded-xl p-4">
                        <div className="text-[10px] text-white/40 uppercase mb-1">외국인</div>
                        <div className="text-lg font-mono">{(latest.kosdaq.foreign / 100).toFixed(0)}<span className="text-xs ml-1 text-white/30">억</span></div>
                      </div>
                      <div className="bg-white/5 rounded-xl p-4">
                        <div className="text-[10px] text-white/40 uppercase mb-1">기관</div>
                        <div className="text-lg font-mono">{(latest.kosdaq.institutional / 100).toFixed(0)}<span className="text-xs ml-1 text-white/30">억</span></div>
                      </div>
                      <div className="bg-white/5 rounded-xl p-4 border border-orange-500/20">
                        <div className="text-[10px] text-orange-400/60 uppercase mb-1">비차익</div>
                        <div className="text-lg font-mono">{(latest.kosdaq.program_non_arbitrage / 100).toFixed(0)}<span className="text-xs ml-1 text-white/30">억</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6">
                <h3 className="text-sm font-medium text-white/40 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Settings className="w-4 h-4" /> 작동 스케줄
                </h3>
                <ul className="space-y-3 text-sm">
                  <li className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-white/60">작동 요일</span>
                    <span className="font-mono">월 - 금 (평일)</span>
                  </li>
                  <li className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-white/60">작동 시간</span>
                    <span className="font-mono">09:30 - 15:30</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-white/60">전송 간격</span>
                    <span className="font-mono text-orange-400">30분 마다</span>
                  </li>
                </ul>
              </div>

              <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6">
                <h3 className="text-sm font-medium text-white/40 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" /> 수집 데이터
                </h3>
                <div className="flex flex-wrap gap-2">
                  {["KOSPI", "KOSDAQ", "개인", "외국인", "기관", "비차익 프로그램"].map(tag => (
                    <span key={tag} className="px-3 py-1 bg-white/5 rounded-md text-xs text-white/70 border border-white/10">
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="mt-4 text-xs text-white/40 leading-relaxed">
                  네이버 금융의 실시간 데이터를 기반으로 30분 전 및 1시간 전 데이터와 비교하여 증감액을 계산합니다.
                </p>
              </div>
            </div>
          </div>

          {/* Sidebar: Setup Instructions */}
          <div className="space-y-6">
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-6">
              <h3 className="text-orange-400 font-semibold mb-4 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" /> 설정 가이드
              </h3>
              <div className="space-y-4 text-sm leading-relaxed text-white/80">
                <p>
                  1. <strong className="text-white">@BotFather</strong>를 통해 봇을 생성하고 <strong className="text-white">API Token</strong>을 받으세요.
                </p>
                <p>
                  2. 생성한 봇에 메시지를 보내거나 대화방에 초대하세요.
                </p>
                <p>
                  3. <strong className="text-white">@userinfobot</strong> 등을 통해 본인의 <strong className="text-white">Chat ID</strong>를 확인하세요.
                </p>
                <p>
                  4. AI Studio의 <strong className="text-white">Settings &gt; Secrets</strong> 탭에서 다음 변수를 추가하세요:
                </p>
                <div className="bg-black/40 rounded-lg p-3 font-mono text-xs text-orange-200/70 space-y-1">
                  <div>TELEGRAM_BOT_TOKEN</div>
                  <div>TELEGRAM_CHAT_ID</div>
                </div>
              </div>
            </div>

            <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6">
              <h3 className="text-white/40 text-xs font-bold uppercase tracking-widest mb-4">현재 상태</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60">서버 상태</span>
                  <span className="w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60">데이터 소스</span>
                  <span className="text-sm font-medium">Naver Finance</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60">DB 연결</span>
                  <span className="text-sm font-medium text-emerald-400">Firestore OK</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {error && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 animate-bounce">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}
    </div>
  );
}
