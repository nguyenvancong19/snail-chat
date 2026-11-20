const legacyColumns=['sku','name','price','in_stock','image_url'];
export const catalogColumns=[...legacyColumns,'description','detail_image_1','detail_image_2','detail_image_3'];

export function csvProducts(text) {
  const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
  const delimiter=lines[0].includes(';')?';':',';
  function fields(line) {
    const values=[];
    let field='', quoted=false;
    for(let i=0;i<line.length;i++){
      const char=line[i];
      if(char==='"'){
        if(quoted&&line[i+1]==='"'){field+='"';i++;}
        else quoted=!quoted;
      }else if(char===delimiter&&!quoted){values.push(field.trim());field='';}
      else field+=char;
    }
    if(quoted)throw new Error('Mỗi sản phẩm cần nằm trên một dòng CSV.');
    return [...values,field.trim()];
  }
  return catalogProducts(lines.map(fields));
}

export function catalogProducts(rows) {
  const text=(value)=>String(value??'').trim();
  const [header=[],...data]=rows;
  const labels=header.map(text).join(',');
  const extended=labels===catalogColumns.join(',');
  if(!extended&&labels!==legacyColumns.join(',')){
    throw new Error('Hàng tiêu đề không khớp các cột trong tệp mẫu.');
  }
  const items=[];
  data.forEach((row,index)=>{
    const values=row.map(text);
    if(!values.some(Boolean))return;
    const [sku,name,price,stock,image_url,description='',...detail_images]=values;
    const photos=detail_images.slice(0,3).filter(Boolean);
    if(values.slice(extended?9:5).some(Boolean)||photos.length>0&&photos.length!==3||!sku||!name||!/^\d+$/.test(price)||!['0','1'].includes(stock)||!image_url){
      throw Object.assign(new Error('Cần giá nguyên, tồn hàng 1 hoặc 0, URL ảnh đại diện và đủ ba ảnh chi tiết nếu có.'),{row:index+2});
    }
    items.push({sku,name,price:Number(price),in_stock:stock==='1',image_url,
      ...(extended?{description,detail_images:photos}:{})});
  });
  if(!items.length)throw new Error('Tệp chưa có sản phẩm.');
  return items;
}
