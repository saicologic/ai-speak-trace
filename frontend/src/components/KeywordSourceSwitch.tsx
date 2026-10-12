import type { KeywordSourceState } from '../hooks/useKeywordSource';
import './KeywordSourceSwitch.css';

interface Props {
  state: KeywordSourceState;
}

/** キーワードの出し方（標準 / GiNZA）の切り替えと、GiNZA の準備の状態 */
export function KeywordSourceSwitch({ state }: Props) {
  const { source, setSource, status, loading, error, install } = state;

  return (
    <div className="keyword-source">
      <div className="keyword-source-tabs" role="group" aria-label="キーワードの出し方">
        <button
          type="button"
          className={source === 'standard' ? 'active' : ''}
          aria-pressed={source === 'standard'}
          onClick={() => setSource('standard')}
        >
          標準
        </button>
        <button
          type="button"
          className={source === 'ginza' ? 'active' : ''}
          aria-pressed={source === 'ginza'}
          onClick={() => setSource('ginza')}
          title="日本語を解析して、漢字の語（評価・型チェックなど）も取り出します"
        >
          GiNZA
        </button>
      </div>
      {source === 'ginza' && (
        <div className="keyword-source-status" role="status">
          {status?.state === 'not_installed' && (
            <>
              <p>{status.message}。初めて使うときは、Python と GiNZA（約 500MB）をダウンロードして入れます。</p>
              <button type="button" className="keyword-source-install" onClick={install}>
                GiNZA を入れる
              </button>
            </>
          )}
          {status?.state === 'installing' && (
            <p className="keyword-source-progress">{status.message || 'GiNZA を準備しています'}…</p>
          )}
          {status?.state === 'unsupported' && <p>{status.message}</p>}
          {status?.state === 'error' && (
            <>
              <p className="keyword-source-error">{status.message}</p>
              <button type="button" className="keyword-source-install" onClick={install}>
                もう一度入れる
              </button>
            </>
          )}
          {status?.state === 'ready' && loading && (
            <p className="keyword-source-progress">日本語を解析しています…</p>
          )}
          {error && <p className="keyword-source-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
