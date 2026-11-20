import './public.css';
import { Brand } from '../ui.jsx';

export const company='CÔNG TY TNHH SNAILSOFT';
export const companyEn='SNAILSOFT COMPANY LIMITED';
export const email='snailsoft06@gmail.com';
export const legalHref=(kind,en=false)=>'/'+kind+(en?'?lang=en':'');

function NavList({items}){
  return <ul>{items.map(([label,href])=><li key={href}><a href={href}>{label}</a></li>)}</ul>;
}

export function PublicChrome({en=false,active,children}){
  const productLinks=[[en?'Features':'Tính năng','/#features'],[en?'Workflow':'Quy trình','/#workflow'],[en?'Platforms':'Nền tảng','/#platforms']];
  const terms=en?'Terms of Service':'Điều khoản sử dụng';
  const privacy=en?'Privacy Policy':'Chính sách bảo mật';
  const accounts=[[en?'Sign in':'Đăng nhập','/login'],[en?'Create account':'Tạo tài khoản','/login#register']];
  const legalLinks=en
    ? [[terms,legalHref('terms',true)],[privacy,legalHref('privacy',true)],['Điều khoản sử dụng',legalHref('terms')],['Chính sách bảo mật',legalHref('privacy')]]
    : [[terms,legalHref('terms')],[privacy,legalHref('privacy')],['Terms of Service (English)',legalHref('terms',true)],['Privacy Policy (English)',legalHref('privacy',true)]];
  return <div className="public-site" lang={en?'en':'vi'}>
    <a href="#main" className="skip btn">{en?'Skip to content':'Đến nội dung'}</a>
    <header className="bar"><div className="wrap">
      <Brand href="/"/>
      <nav aria-label={en?'Main navigation':'Điều hướng chính'}>
        {productLinks.map(([label,href])=><a key={href} href={href}>{label}</a>)}
        <a className="legal-nav" aria-current={active==='terms'?'page':undefined} href={legalHref('terms',en)}>{terms}</a>
        <a className="legal-nav" aria-current={active==='privacy'?'page':undefined} href={legalHref('privacy',en)}>{privacy}</a>
      </nav>
      <div className="actions">
        <a className="btn small" href={accounts[0][1]}>{accounts[0][0]}</a>
        <a className="btn primary small" href={accounts[1][1]}>{accounts[1][0]}</a>
      </div>
    </div></header>
    {children}
    <footer className="footer"><div className="wrap">
      <div className="footgrid">
        <div><Brand href="/"/><p>{en?'Manage messages, comments and orders in one workspace.':'Quản lý tin nhắn, bình luận và đơn hàng từ một nơi.'}</p></div>
        <div><h2>{en?'Contact':'Liên hệ'}</h2><p>{en?companyEn:company}<br/>({en?company:companyEn})</p><a href={'mailto:'+email}>{email}</a></div>
        <div><h2>{en?'Product':'Sản phẩm'}</h2><NavList items={productLinks}/></div>
        <div><h2>{en?'Account':'Tài khoản'}</h2><NavList items={accounts}/></div>
        <div><h2>{en?'Legal':'Pháp lý'}</h2><NavList items={legalLinks}/></div>
      </div>
      <small>© 2026 {en?companyEn+'. All rights reserved.':company+'. Bảo lưu mọi quyền.'}</small>
    </div></footer>
  </div>;
}
