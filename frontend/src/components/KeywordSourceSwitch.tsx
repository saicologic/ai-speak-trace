import type { KeywordSourceState } from '../hooks/useKeywordSource';

interface Props {
  state: KeywordSourceState;
}

/** 切り替えのボタン：選んでいるほうを青くし、カーソルを乗せても色を変えない */
const tabClass = 'flex-1 px-1 py-[0.35rem] text-xs font-semibold whitespace-nowrap transition-colors duration-150';
const activeTabClass = 'bg-primary text-white';
const inactiveTabClass = 'bg-white text-gray-600 hover:bg-gray-100';
const tabClassOf = (active: boolean) => `${tabClass} ${active ? activeTabClass : inactiveTabClass}`;

/** GiNZA の状態の文 */
const statusTextClass = 'mb-[0.4rem] leading-normal';
/** 「GiNZA を入れる」「もう一度入れる」ボタン */
const installButtonClass =
  'rounded-md border-primary bg-white px-3 py-[0.35rem] text-xs font-semibold text-primary hover:bg-blue-50';

/** キーワードの出し方（標準 / GiNZA）の切り替えと、GiNZA の準備の状態 */
export function KeywordSourceSwitch({ state }: Props) {
  const { source, setSource, status, loading, error, install } = state;

  return (
    <div className="mb-3">
      <div className="flex overflow-hidden rounded-lg border border-gray-300" role="group" aria-label="キーワードの出し方">
        <button
          type="button"
          className={`${tabClassOf(source === 'standard')} border-none`}
          aria-pressed={source === 'standard'}
          onClick={() => setSource('standard')}
        >
          標準
        </button>
        <button
          type="button"
          // 2 つ目のボタンだけ、左に区切りの線を引く
          className={`${tabClassOf(source === 'ginza')} border-0 border-l border-gray-300`}
          aria-pressed={source === 'ginza'}
          onClick={() => setSource('ginza')}
          title="日本語を解析して、漢字の語（評価・型チェックなど）も取り出します"
        >
          GiNZA
        </button>
      </div>
      {source === 'ginza' && (
        <div className="mt-2 text-xs text-gray-500" role="status">
          {status?.state === 'not_installed' && (
            <>
              <p className={statusTextClass}>{status.message}。初めて使うときは、Python と GiNZA（約 500MB）をダウンロードして入れます。</p>
              <button type="button" className={installButtonClass} onClick={install}>
                GiNZA を入れる
              </button>
            </>
          )}
          {status?.state === 'installing' && (
            <p className={`${statusTextClass} text-blue-600`}>{status.message || 'GiNZA を準備しています'}…</p>
          )}
          {status?.state === 'unsupported' && <p className={statusTextClass}>{status.message}</p>}
          {status?.state === 'error' && (
            <>
              <p className={`${statusTextClass} text-red-600`}>{status.message}</p>
              <button type="button" className={installButtonClass} onClick={install}>
                もう一度入れる
              </button>
            </>
          )}
          {status?.state === 'ready' && loading && (
            <p className={`${statusTextClass} text-blue-600`}>日本語を解析しています…</p>
          )}
          {error && <p className={`${statusTextClass} text-red-600`}>{error}</p>}
        </div>
      )}
    </div>
  );
}
