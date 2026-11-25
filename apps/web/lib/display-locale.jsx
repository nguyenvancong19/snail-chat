'use client';

import {createContext,useContext,useEffect,useState} from 'react';
import {isDisplayLocale,locales,message} from './locale.js';
import {displayCopy} from './display-catalog.jsx';

export const DisplayLocale=createContext('vi');
export const DisplayCatalog=createContext(null);

export function useDeviceDisplayLocale() {
  const [locale,setLocale]=useState('vi');
  useEffect(()=>{
    try{
      const saved=window.localStorage.getItem('snailchat.displayLocale');
      if(isDisplayLocale(saved))setLocale(saved);
    }catch{}
  },[]);
  return locale;
}
export function useDisplayLocale() {
  const locale=useContext(DisplayLocale);
  const catalog=useContext(DisplayCatalog);
  const copy=(label)=>displayCopy(locale,catalog,label);
  return {locale,intl:locales[locale].intl,t:(key,values)=>message(locale,key,values),
    text:copy,copy,translatedContent:(key,source)=>displayCopy(locale,catalog,source,key),
    translationStatus:catalog?.status??'ready'};
}
