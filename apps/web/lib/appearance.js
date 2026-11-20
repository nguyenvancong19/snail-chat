const black='#15121e', white='#ffffff';
const rgb=(hex)=>hex.slice(1).match(/../g).map((part)=>parseInt(part,16));
export function blend(a,b,ratio){
  const right=rgb(b);
  return '#'+rgb(a).map((v,i)=>Math.round(v*(1-ratio)+right[i]*ratio).toString(16).padStart(2,'0')).join('');
}
function luminance(hex){
  return rgb(hex).map((v)=>v/255).map((v)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
    .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
}
export function contrast(a,b){
  const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);
  return (values[0]+.05)/(values[1]+.05);
}
function ink(bg){return contrast(black,bg)>=contrast(white,bg)&&contrast(black,bg)>=4.5?black:
  contrast('#000000',bg)>contrast(white,bg)?'#000000':white;}
function legible(color,bg,minimum=4.5){
  if(contrast(color,bg)>=minimum)return color;
  const target=ink(bg);
  for(let n=1;n<=20;n++){
    const candidate=blend(color,target,n/20);
    if(contrast(candidate,bg)>=minimum)return candidate;
  }
  return target;
}
const block=(name,bg,accent)=>({
  [name]:bg,[name+'-ink']:ink(bg),[name+'-muted']:legible(blend(bg,ink(bg),.62),bg),
  [name+'-link']:legible(accent,bg),[name+'-line']:blend(bg,ink(bg),.20),
});

export function paletteTokens({background,accent}){
  const dark=ink(background)===white;
  const surface=blend(background,white,dark?.075:.55);
  const rail=blend(background,dark?'#000000':'#ffffff',dark?.145:.30);
  const soft=blend(surface,dark?white:'#27213c',dark?.075:.045);
  const selected=blend(rail,accent,dark?.24:.17);
  const green='#279069',amber='#cf801e',red='#bc405e';
  const status=blend(surface,green,.19),pending=blend(surface,amber,.19);
  return {
    scheme:dark?'dark':'light',canvas:background,ink:ink(background),muted:legible(blend(background,ink(background),.61),background),
    link:legible(accent,background),line:blend(background,ink(background),.20),
    ...block('surface',surface,accent),...block('rail',rail,accent),...block('soft',soft,accent),
    accent,'on-accent':ink(accent),'accent-edge':legible(accent,surface,2.1),
    selected,'selected-ink':legible(accent,selected),'selected-line':blend(selected,ink(selected),.23),
    'danger-bg':blend(surface,red,.19),'danger-ink':legible(red,blend(surface,red,.19)),
    'danger-text':legible(red,surface),'danger-canvas':legible(red,background),
    'status-bg':status,'status-ink':legible(green,status),'pending-bg':pending,'pending-ink':legible(amber,pending),
  };
}

export const palettes={
  iris:{light:{background:'#f3f1f9',accent:'#7046cf'},dark:{background:'#171421',accent:'#b79cf7'}},
  ocean:{light:{background:'#edf4fc',accent:'#1165bc'},dark:{background:'#101b2b',accent:'#68aff8'}},
  forest:{light:{background:'#edf6ee',accent:'#227553'},dark:{background:'#131f1b',accent:'#62cfa0'}},
  plum:{light:{background:'#faeff1',accent:'#a73966'},dark:{background:'#351520',accent:'#ef9ebc'}},
};

export const hexPattern=/^#[a-f\d]{6}$/i;
const color=(value,fallback)=>hexPattern.test(value)?value.toLowerCase():fallback;
const languages=['vi','en','ko','ja','zh','th','lo'];

export function appearancePreferences(value) {
  const {mode,locale,background,accent,light,dark}=value??{};
  const palette=(key,settings)=>({
    background:color(settings?.background,color(mode===key?background:null,palettes.iris[key].background)),
    accent:color(settings?.accent,color(mode===key?accent:null,palettes.iris[key].accent)),
  });
  return {
    mode:['light','dark','system'].includes(mode)?mode:'light',
    locale:languages.includes(locale)?locale:'vi',
    light:palette('light',light),
    dark:palette('dark',dark),
  };
}

export const effectiveTheme=(mode,systemDark)=>mode==='system'?(systemDark?'dark':'light'):mode;

export function themeStyle(palette) {
  const {scheme,...tokens}=paletteTokens(palette);
  return {
    mode:scheme,
    style:{colorScheme:scheme,...Object.fromEntries(Object.entries(tokens).map(([name,value])=>['--theme-'+name,value]))},
  };
}
