import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import pinia from './stores'
import './styles/fonts.scss'
import './styles/base.scss'

createApp(App).use(pinia).use(router).mount('#app')
