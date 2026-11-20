import { LegalPage } from '../../components/public/legal.jsx';

export async function generateMetadata({searchParams}){
  const en=(await searchParams).lang==='en';
  return {title:en?'Terms of Service — SnailChat':'Điều khoản sử dụng — SnailChat'};
}

export default async function Page({searchParams}){
  return <LegalPage kind="terms" en={(await searchParams).lang==='en'}/>;
}
