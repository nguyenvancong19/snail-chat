'use client';

import { useState } from 'react';
import { PublicChrome } from './chrome.jsx';
import content from './feature-copy.json';

const steps=[
  ['Kết nối kênh','Chọn Facebook Page hoặc Instagram Professional và cấp quyền theo nhu cầu.'],
  ['Thiết lập cách phản hồi','Phân quyền thành viên. Thêm tài liệu và cấu hình Agent nếu gói hỗ trợ.'],
  ['Theo dõi và xử lý','Mở hộp thư, duyệt phản hồi, cập nhật đơn và xem tình hình tương tác.'],
];

export default function Landing(){
  const [active,setActive]=useState(0);
  const {items,title,received,reply,status}=content.samples[active];
  return <PublicChrome><main id="main" tabIndex={-1}>
    <section className="public-intro"><div className="wrap">
      <div>
        <span className="eyebrow">Hộp thư và AI Agent cho đội ngũ bán hàng</span>
        <h1>Chăm sóc khách hàng<br/><em>từ một nơi.</em></h1>
        <p>Theo dõi tin nhắn, trả lời bình luận và quản lý đơn hàng từ các Page đã kết nối. Đội ngũ của bạn có thể cùng xử lý tương tác và dùng AI Agent để soạn phản hồi.</p>
        <div className="actions"><a className="btn primary" href="/login#register">Tạo tài khoản</a><a className="btn" href="#features">Xem tính năng ↓</a></div>
      </div>
      <div className="product">
        <header><strong>Không gian làm việc</strong><span>Dữ liệu minh họa</span></header>
        <div className="product-tabs" role="group" aria-label="Xem công cụ mẫu">
          {content.samples.map(({label},index)=><button key={label} type="button" aria-pressed={active===index} onClick={()=>setActive(index)}>{label}</button>)}
        </div>
        <div className="preview" aria-live="polite">
          <ul aria-label="Danh sách mẫu">{items.map(label=><li key={label}>{label}</li>)}</ul>
          <div className="public-thread"><h3>{title}</h3><span className="bubble">{received}</span><span className="bubble out">{reply}</span><span className="tag">{status}</span></div>
        </div>
      </div>
    </div></section>
    <section className="feature-section wrap" id="features">
      <div className="intro"><h2>Công cụ trong SnailChat</h2><p>Từ lúc khách hỏi sản phẩm đến khi đội ngũ xử lý đơn.</p></div>
      <div className="grid">{content.features.map(([path,title,description])=><article className="card" key={title}>
        <span className="card-icon"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={path}/></svg></span>
        <h3>{title}</h3><p>{description}</p>
      </article>)}</div>
    </section>
    <section className="flow" id="workflow"><div className="wrap">
      <h2>Quy trình làm việc</h2><div className="grid steps">{steps.map(([title,description])=><article className="card" key={title}><h3>{title}</h3><p>{description}</p></article>)}</div>
    </div></section>
    <section className="platforms" id="platforms"><div className="wrap">
      <div><h2>Nền tảng kết nối</h2><p>Tính năng hiển thị tùy quyền và loại kênh.</p></div>
      <div className="actions">{['Facebook Page','Messenger','Instagram Professional'].map(label=><span className="pill" key={label}>{label}</span>)}</div>
    </div></section>
  </main></PublicChrome>;
}

