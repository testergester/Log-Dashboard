import * as store from './firebase-client.js';
export {store};
export function initializeAccess({onUser,onConnection,onError}){
  const button=document.querySelector('#login-button');
  button.disabled=!store.configured;
  document.querySelector('#login-form').addEventListener('submit',async e=>{
    e.preventDefault();button.disabled=true;
    try{await store.login();}catch(error){onError(error);}finally{button.disabled=!store.configured;}
  });
  document.querySelector('#sign-out-button').addEventListener('click',async()=>{try{await store.logout();}catch(error){onError(error);}});
  store.observeAuth(onUser);store.observeConnection(onConnection);
  if(store.emulatorMode){
    const form=document.createElement('form');form.className='access-form';form.id='emulator-login';
    form.innerHTML='<p>Local emulator only</p><label>Email<input name="email" type="email" required></label><label>Password<input name="password" type="password" minlength="6" required></label><button class="button" type="submit">Sign in locally</button>';
    document.querySelector('.access-content').append(form);
    form.addEventListener('submit',async e=>{e.preventDefault();try{await store.emulatorLogin(form.elements.email.value,form.elements.password.value);}catch(error){onError(error);}});
  }
}
