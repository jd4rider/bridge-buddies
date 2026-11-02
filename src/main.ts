import './style.css'
import { BridgeApp } from './game/app'

const root = document.getElementById('app')
if (root) new BridgeApp(root)
