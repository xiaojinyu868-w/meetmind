import { COPY } from '@/lib/ui/copy';
import styles from './LandingCollectionLine.module.css';

type ThreadItem = (typeof COPY.landing.collectionLine.wechatThread)[number];

function WxOutbound({ item }: { item: ThreadItem }) {
  if (item.kind === 'link') {
    return (
      <span className={styles.wxLinkCard}>
        <strong>{item.inbound}</strong>
        <small>网页链接</small>
      </span>
    );
  }
  if (item.kind === 'image') {
    return (
      <span className={styles.wxPhoto}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="m4 18 5-5 3 3 4-4 4 4" />
        </svg>
        <em>{item.inbound}</em>
      </span>
    );
  }
  return <span>{item.inbound}</span>;
}

export function LandingCollectionLine() {
  const copy = COPY.landing.collectionLine;
  return (
    <section className={styles.collectionLine} id="collection" aria-labelledby="collection-line-title">
      <div className={styles.collectionStage}>
        <div className={styles.collectionVisual} aria-hidden="true">
          <div className={styles.phone}>
            <div className={styles.phoneScreen}>
              <div className={styles.phoneHead}>
                <span className={styles.phoneBack}>‹</span>
                <strong>{copy.wechatHeader}</strong>
                <span className={styles.phoneDots}>···</span>
              </div>
              <div className={styles.phoneThread}>
                {copy.wechatThread.map((item) => (
                  <div className={styles.exchange} key={item.inbound}>
                    <div className={styles.wxOut}>
                      <WxOutbound item={item} />
                    </div>
                    <div className={styles.wxIn}>{item.reply}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {copy.sideChannels.map((item, index) => (
            <div className={styles.sideCard} data-pos={index === 0 ? 'left' : 'right'} key={item.channel}>
              <span className={styles.sideChip} data-channel={item.channel}>{item.channel}</span>
              <div className={styles.sideText}>
                {item.kind === 'voice' ? (
                  <span className={styles.inVoice}>
                    <i /><i /><i /><i /><i /><i />
                    <em>{item.text}</em>
                  </span>
                ) : (
                  <span className={styles.inImage}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="4" width="18" height="16" rx="3" />
                      <circle cx="9" cy="10" r="1.6" />
                      <path d="m4 18 5-5 3 3 4-4 4 4" />
                    </svg>
                    <em>{item.text}</em>
                  </span>
                )}
              </div>
              <div className={styles.sideReply}>
                <i />
                {item.reply}
              </div>
            </div>
          ))}

          <div className={styles.collectionStatus}>
            <i />
            <span>{copy.statusLabel}</span>
          </div>
        </div>
        <div className={styles.collectionCopy}>
          <span className={styles.eyebrow} data-reveal>{copy.eyebrow}</span>
          <h2 id="collection-line-title" data-reveal style={{ transitionDelay: '80ms' }}>{copy.title}</h2>
          <p data-reveal style={{ transitionDelay: '160ms' }}>{copy.body}</p>
          <p className={styles.collectionNote} data-reveal style={{ transitionDelay: '240ms' }}>
            <i />
            {copy.silentNote}
          </p>
          <p className={styles.channelNote} data-reveal style={{ transitionDelay: '320ms' }}>{copy.channelNote}</p>
        </div>
      </div>
    </section>
  );
}
