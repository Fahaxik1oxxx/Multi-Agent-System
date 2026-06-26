import { Puzzle } from 'lucide-react';

export function TemplateMarket() {
  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-[#1d1d1f]">模板市场</h1>
        <p className="text-[#81858c] mt-1">浏览预置场景模板，一键克隆到你的工作空间</p>

        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Puzzle className="h-12 w-12 text-[#d0d4d8]" />
          <h3 className="mt-4 text-lg font-medium text-[#1d1d1f]">即将上线</h3>
          <p className="mt-1 text-sm text-[#81858c] max-w-sm">
            模板市场将在 Phase 2B 中实现，届时你可以浏览和克隆社区共享的 Agent 配置模板
          </p>
        </div>
      </div>
    </div>
  );
}
