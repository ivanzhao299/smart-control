// 数据内联编辑功能
(function(){
  const STORAGE_KEY='park-ops-data-edits';
  let editMode=false;
  let currentEl=null;
  let editPopup=null;

  // 生成元素唯一路径
  function getElementPath(el){
    const path=[];
    let node=el;
    while(node&&node.nodeType===1&&node!==document.body){
      let selector=node.tagName.toLowerCase();
      if(node.id){selector+='#'+node.id;path.unshift(selector);break}
      const parent=node.parentNode;
      if(parent){
        const siblings=Array.from(parent.children).filter(c=>c.tagName===node.tagName);
        if(siblings.length>1){selector+=':nth-of-type('+(siblings.indexOf(node)+1)+')'}
      }
      path.unshift(selector);
      node=node.parentNode;
    }
    return path.join('>');
  }

  // 加载保存的编辑
  function loadEdits(){
    try{
      const edits=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');
      Object.keys(edits).forEach(path=>{
        try{
          const el=document.querySelector(path);
          if(el&&el.dataset.editable!=='false'){el.textContent=edits[path]}
        }catch(e){}
      });
    }catch(e){}
  }

  // 保存编辑
  function saveEdit(path,value){
    try{
      const edits=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');
      edits[path]=value;
      localStorage.setItem(STORAGE_KEY,JSON.stringify(edits));
    }catch(e){}
  }

  // 判断元素是否可编辑
  function isEditable(el){
    if(!el||el.nodeType!==1)return false;
    const tag=el.tagName.toLowerCase();
    if(['button','input','textarea','select','video','canvas','svg','script','style','iframe'].includes(tag))return false;
    if(el.closest('.data-edit-input,.data-edit-tip'))return false;
    if(el.dataset.editable==='false')return false;
    // 必须有直接文本子节点
    const hasText=Array.from(el.childNodes).some(n=>n.nodeType===3&&n.textContent.trim());
    return hasText;
  }

  // 标记所有可编辑元素
  function markEditable(){
    document.querySelectorAll('.editable-field').forEach(el=>el.classList.remove('editable-field'));
    const all=document.querySelectorAll('#app *');
    all.forEach(el=>{
      if(isEditable(el)){
        // 只标记最内层的可编辑元素，避免嵌套
        const hasEditableChild=Array.from(el.children).some(c=>isEditable(c));
        if(!hasEditableChild){el.classList.add('editable-field')}
      }
    });
  }

  // 创建编辑弹出框
  function createEditPopup(el,rect){
    removeEditPopup();
    editPopup=document.createElement('div');
    editPopup.className='data-edit-input';
    editPopup.innerHTML=`<input type="text" value="${el.textContent.replace(/"/g,'&quot;')}" placeholder="输入新内容"><div class="edit-actions"><button class="cancel-btn">取消</button><button class="save-btn">保存</button></div>`;
    document.body.appendChild(editPopup);
    // 定位
    const popupRect=editPopup.getBoundingClientRect();
    let left=rect.left;
    let top=rect.bottom+8;
    if(left+popupRect.width>window.innerWidth)left=window.innerWidth-popupRect.width-10;
    if(top+popupRect.height>window.innerHeight)top=rect.top-popupRect.height-8;
    editPopup.style.left=left+'px';
    editPopup.style.top=top+'px';
    const input=editPopup.querySelector('input');
    input.focus();
    input.select();
    // 事件
    editPopup.querySelector('.save-btn').onclick=()=>{
      const newValue=input.value.trim();
      if(newValue){
        el.textContent=newValue;
        const path=getElementPath(el);
        saveEdit(path,newValue);
      }
      removeEditPopup();
    };
    editPopup.querySelector('.cancel-btn').onclick=removeEditPopup;
    input.onkeydown=(e)=>{
      if(e.key==='Enter')editPopup.querySelector('.save-btn').click();
      if(e.key==='Escape')removeEditPopup();
    };
  }

  function removeEditPopup(){
    if(editPopup){editPopup.remove();editPopup=null}
    if(currentEl){currentEl.classList.remove('editing');currentEl=null}
  }

  // 切换编辑模式
  function toggleEditMode(){
    editMode=!editMode;
    document.body.classList.toggle('data-edit-mode',editMode);
    const btn=document.getElementById('toggleDataEdit');
    if(btn){
      btn.textContent=editMode?'✓ 完成绑定':'✎ 数据绑定';
      btn.style.background=editMode?'rgba(239,68,68,.15)':'rgba(34,197,94,.15)';
      btn.style.borderColor=editMode?'rgba(239,68,68,.4)':'rgba(34,197,94,.4)';
      btn.style.color=editMode?'#f87171':'#4ade80';
    }
    if(editMode){
      markEditable();
      // 添加提示
      let tip=document.querySelector('.data-edit-tip');
      if(!tip){
        tip=document.createElement('div');
        tip.className='data-edit-tip';
        tip.textContent='编辑模式：点击任意文字可修改内容，修改后自动保存';
        document.body.appendChild(tip);
      }
    }else{
      removeEditPopup();
      document.querySelectorAll('.editable-field').forEach(el=>el.classList.remove('editable-field'));
      const tip=document.querySelector('.data-edit-tip');
      if(tip)tip.remove();
    }
  }

  // 点击事件
  document.addEventListener('click',(e)=>{
    if(!editMode)return;
    if(e.target.closest('.data-edit-input'))return;
    const el=e.target.closest('.editable-field');
    if(el){
      e.preventDefault();
      e.stopPropagation();
      currentEl=el;
      el.classList.add('editing');
      const rect=el.getBoundingClientRect();
      createEditPopup(el,rect);
    }else{
      removeEditPopup();
    }
  },true);

  // 初始化
  loadEdits();
  const btn=document.getElementById('toggleDataEdit');
  if(btn)btn.onclick=toggleEditMode;
  // 页面内容动态加载后重新标记（如果在编辑模式）
  const observer=new MutationObserver(()=>{if(editMode)markEditable()});
  observer.observe(document.getElementById('app'),{childList:true,subtree:true});
})();
