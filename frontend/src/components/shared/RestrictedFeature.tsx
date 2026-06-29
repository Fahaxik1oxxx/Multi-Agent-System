import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

interface Props {
  /** 功能名称，用于提示文案 */
  feature: string;
  /** 子元素（触发区域） */
  children: React.ReactNode;
  /** 点击后的回调（仅非游客模式触发） */
  onAction?: () => void;
}

export function RestrictedFeature({ feature, children, onAction }: Props) {
  const { isGuest } = useAuthStore();
  const [show, setShow] = useState(false);

  const handleClick = () => {
    if (isGuest) {
      setShow(true);
    } else {
      onAction?.();
    }
  };

  return (
    <>
      <div onClick={handleClick} className="inline-block">
        {children}
      </div>

      {show &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
            onClick={() => setShow(false)}
          >
            <div
              className="bg-white rounded-2xl shadow-xl p-6 mx-4 max-w-sm w-full text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-3xl mb-3">🔒</div>
              <h3 className="text-lg font-semibold text-[#1d1d1f] mb-1">
                「{feature}」需要注册
              </h3>
              <p className="text-sm text-[#81858c] mb-5">
                注册后即可使用全部功能，当前会话也会自动迁移到你的账号
              </p>
              <div className="flex gap-2 justify-center">
                <Link
                  to="/register"
                  className="btn btn-sm"
                  style={{
                    background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)',
                    color: '#fff',
                    borderRadius: '8px',
                    border: 'none',
                  }}
                  onClick={() => setShow(false)}
                >
                  立即注册
                </Link>
                <button
                  className="btn btn-sm btn-outline"
                  style={{ borderRadius: '8px' }}
                  onClick={() => setShow(false)}
                >
                  继续试用
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
