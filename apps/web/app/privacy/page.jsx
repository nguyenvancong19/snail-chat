import { LegalPage } from '../../components/public/legal.jsx';

export async function generateMetadata({searchParams}){
  const en=(await searchParams).lang==='en';
  return {title:en?'Privacy Policy — SnailChat':'Chính sách bảo mật — SnailChat'};
}

export default async function Page({searchParams}){
  return <LegalPage kind="privacy" en={(await searchParams).lang==='en'}/>;
}
