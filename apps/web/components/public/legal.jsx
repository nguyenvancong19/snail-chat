import { PublicChrome,company,companyEn,email,legalHref } from './chrome.jsx';
import articles from './legal-copy.json';

export function LegalPage({kind,en}){
  const isPrivacy=kind==='privacy';
  const entries=articles[kind];
  const title=isPrivacy?(en?'Privacy Policy':'Chính sách bảo mật'):(en?'Terms of Service':'Điều khoản sử dụng');
  const intro=isPrivacy
    ? (en?'Learn what SnailChat processes, why it uses the data, and how to submit a privacy request.':'Tìm hiểu SnailChat xử lý dữ liệu nào, sử dụng vào việc gì và cách gửi yêu cầu về quyền riêng tư.')
    : (en?'The terms that apply when you use SnailChat.':'Các điều khoản áp dụng khi bạn sử dụng SnailChat.');
  const number=(index)=>String(index+1).padStart(2,'0');
  return <PublicChrome en={en} active={kind}><main className="wrap legal-main" id="main" tabIndex={-1}>
    <a className="crumb" href="/">{en?'← Home':'← Trang chủ'}</a>
    <div className="legal-hero">
      <span className="eyebrow">{en?'Legal':'Pháp lý'}</span><h1>{title}</h1><p>{intro}</p>
      <div className="actions">
        <a lang="vi" className="btn lang small" aria-current={!en?'true':undefined} href={legalHref(kind)}>Tiếng Việt</a>
        <a lang="en" className="btn lang small" aria-current={en?'true':undefined} href={legalHref(kind,true)}>English</a>
      </div>
      <dl className="metadata">
        <div><dt>{en?'Effective from':'Hiệu lực từ'}</dt><dd><time dateTime="2026-11-12">{en?'12 November 2026':'12 tháng 11, 2026'}</time></dd></div>
        <div><dt>{en?'Operated by':'Đơn vị vận hành'}</dt><dd>{en?companyEn:company}</dd></div>
        <div><dt>{en?'Contact':'Liên hệ'}</dt><dd><a href={'mailto:'+email}>{email}</a></dd></div>
      </dl>
    </div>
    <div className="legal-grid">
      <nav className="toc" aria-label={en?'Contents':'Mục lục'}>
        <details open><summary>{en?'Contents':'Mục lục'}</summary>
          {entries.map((entry,index)=><a key={entry[0]} href={'#section-'+(index+1)}>{number(index)} · {entry[en?1:0]}</a>)}
        </details>
        <a href={legalHref(isPrivacy?'terms':'privacy',en)}>{isPrivacy?(en?'See Terms of Service →':'Xem điều khoản sử dụng →'):(en?'See Privacy Policy →':'Xem chính sách bảo mật →')}</a>
      </nav>
      <article className="article">
        {entries.map((entry,index)=><section key={entry[0]} id={'section-'+(index+1)} tabIndex={-1}>
          <h2><span>{number(index)}</span>{entry[en?1:0]}</h2>
          <p>{entry[en?3:2]}</p>
          {index===entries.length-1&&<a href={'mailto:'+email}>{email}</a>}
        </section>)}
      </article>
    </div>
  </main></PublicChrome>;
}
