'use client';

import { useDisplayLocale } from '../lib/display-locale.jsx';
import { useState } from 'react';
import { CardHead, Empty } from './ui.jsx';

const compactMoney=new Intl.NumberFormat('vi-VN',{notation:'compact',maximumFractionDigits:1});
export function chartDate(date,intl='vi-VN') {
  const monthly=date.length===7;
  const value=new Date((monthly?date+'-01':date)+'T00:00:00Z');
  const options=monthly?{month:'numeric',year:'numeric'}:{month:'numeric',day:'numeric'};
  return new Intl.DateTimeFormat(intl,{...options,timeZone:'UTC'}).format(value);
}
export const chartCurrency=(amount)=>compactMoney.format(amount)+' ₫';

function DataTable({rows,series,format,label}) {
  const {t}=useDisplayLocale();
  return <details className="stat-chart-table">
    <summary>{t('chartData')}</summary>
    <div className="table-wrap"><table>
      <thead><tr><th scope="col">{label}</th>{series.map(({key,name})=><th key={key} scope="col">{name}</th>)}</tr></thead>
      <tbody>{rows.map(({label,values},index)=><tr key={index}><th scope="row">{label}</th>
        {series.map(({key})=><td key={key}>{format(values[key])}</td>)}</tr>)}</tbody>
    </table></div>
  </details>;
}

export function TimeChart({title,subtitle,rows,series,format,axisFormat,label,type='line',action}) {
  const {t,intl}=useDisplayLocale();
  const number=new Intl.NumberFormat(intl);
  format??=(value)=>number.format(value);
  axisFormat??=format;
  label??=t('date');
  const [point,setPoint]=useState(null);
  const active=point!==null&&point<rows.length?point:rows.length-1;
  const current=rows[active];
  const peak=Math.max(0,...rows.flatMap(({values})=>series.map(({key})=>values[key])));
  const unit=10**Math.floor(Math.log10(Math.max(1,peak/4)));
  const step=[1,2,2.5,5,10].map((n)=>n*unit).find((n)=>n>=Math.max(1,peak/4)&&Number.isInteger(n))??10*unit;
  const max=step*4;
  const height=220;
  const x=(index)=>(type==='column'?(index+0.5)/rows.length:rows.length===1?.5:index/(rows.length-1))*100;
  const y=(value)=>(1-value/max)*height;
  const xStride=Math.ceil((rows.length-1)/6);
  const ticks=rows.map((row,index)=>({row,index})).filter(({index})=>index===0||index===rows.length-1||
    (index%xStride===0&&rows.length-1-index>=xStride*.65));
  return <section className="card stat-chart">
    <CardHead title={title} subtitle={subtitle} action={action}/>
    {rows.length?<div className="stat-chart-body">
      <div className="stat-series" aria-hidden="true">{series.map(({key,name,color})=>
        <span key={key}><i className={'stat-swatch '+color}/>{name}</span>)}</div>
      <div className="stat-coordinate">
        <div className="stat-y" aria-hidden="true">{[4,3,2,1,0].map((n)=><span key={n}>{axisFormat(n*step)}</span>)}</div>
        <div className={'stat-plot '+type}>
          <svg className="stat-svg" viewBox="0 0 1000 220" preserveAspectRatio="none" aria-hidden="true">
            {[0,1,2,3,4].map((n)=><line key={n} className="stat-grid-line" x1="0" x2="1000" y1={n*55} y2={n*55}/>)}
            {type==='line'&&<>
              {series.map(({key,color})=><polyline key={key} className={'stat-line '+color} vectorEffect="non-scaling-stroke"
                points={rows.map(({values},index)=>x(index)*10+','+y(values[key])).join(' ')}/>)}
              <line className="stat-guide-line" x1={x(active)*10} x2={x(active)*10} y1="0" y2={height}/>
            </>}
          </svg>
          {type==='line'&&series.map(({key,color})=><i key={key} aria-hidden="true"
            className={'stat-point '+color} style={{left:x(active)+'%',top:y(current.values[key])/height*100+'%'}}/>)}
          <div className="stat-targets" role="group" aria-label={title}>
            {rows.map(({label,values},index)=><button key={index} type="button"
              aria-label={label+' · '+series.map(({key,name})=>name+' '+format(values[key])).join(' · ')}
              aria-pressed={index===active}
              onClick={()=>setPoint(index)} onPointerEnter={()=>setPoint(index)} onFocus={()=>setPoint(index)}
              tabIndex={index===active?0:-1}
              onKeyDown={(event)=>{
                const next=event.key==='ArrowRight'?event.currentTarget.nextElementSibling:
                  event.key==='ArrowLeft'?event.currentTarget.previousElementSibling:null;
                if(next){event.preventDefault();next.focus();}
              }}>
              {type==='column'&&<span aria-hidden="true" className={'stat-column '+series[0].color}
                style={{height:values[series[0].key]/max*100+'%'}}/>}
            </button>)}
          </div>
        </div>
        <div className="stat-x" aria-hidden="true">{ticks.map(({row,index})=>
          <span key={index} style={{left:x(index)+'%'}}>{row.label}</span>)}</div>
      </div>
      <p className="stat-selection"><strong>{current.label}</strong>{series.map(({key,name})=>
        <span key={key}>{name} <b>{format(current.values[key])}</b></span>)}</p>
      {!peak&&<p className="dim">{t('noPeriodData')}</p>}
      <DataTable rows={rows} series={series} format={format} label={label}/>
    </div>:<Empty>{t('noData')}</Empty>}
  </section>;
}

export function DonutChart({title,subtitle,segments}) {
  const {t,intl}=useDisplayLocale();
  const number=new Intl.NumberFormat(intl);
  const total=segments.reduce((sum,{value})=>sum+value,0);
  const rate=total?segments[0].value/total*100:0;
  return <section className="card stat-chart">
    <CardHead title={title} subtitle={subtitle}/>
    <div className="stat-chart-body stat-donut-body">
      <div className={'stat-ring'+(total?'':' no-data')} style={{'--stat-rate':rate+'%'}} aria-hidden="true">
        <strong>{total?Math.round(rate)+'%':'—'}</strong>
      </div>
      <dl className="stat-breakdown">
        {segments.map(({label,value},index)=><div key={label}>
          <dt><i className={'stat-swatch '+(index?'muted':'primary')}/>{label}</dt><dd>{number.format(value)}</dd>
        </div>)}
        <div><dt>{t('total')}</dt><dd>{number.format(total)}</dd></div>
      </dl>
    </div>
  </section>;
}

export function ComparisonChart({title,subtitle,rows,stacked=false}) {
  const {t,intl}=useDisplayLocale();
  const number=new Intl.NumberFormat(intl);
  const max=Math.max(1,...rows.map(({value})=>value));
  return <section className="card stat-chart">
    <CardHead title={title} subtitle={subtitle}/>
    <div className="stat-chart-body">
      {stacked&&<div className="stat-series" aria-hidden="true"><span><i className="stat-swatch primary"/>{t('repliedLabel')}</span>
        <span><i className="stat-swatch muted"/>{t('remaining')}</span></div>}
      <ul className="stat-comparison">{rows.map(({id,label,value,total,href})=>{
        const percent=stacked?(total?value/total*100:0):value/max*100;
        return <li key={id??label}>
          <div>{href?<a href={href} target="_blank" rel="noopener noreferrer">{label}</a>:<strong>{label}</strong>}
            <span>{stacked?(total?Math.round(percent)+'% · '+number.format(value)+'/'+number.format(total):t('noChartData')):number.format(value)}</span></div>
          <div className="stat-track" aria-hidden="true"><span style={{width:percent+'%'}}/></div>
        </li>;
      })}</ul>
    </div>
  </section>;
}
