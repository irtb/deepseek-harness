import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.tsx'
import { AuthProvider } from './auth.tsx'

const root = document.getElementById('root')
if (root === null) throw new Error('missing #root')
ReactDOM.createRoot(root).render(
  <React.StrictMode><AuthProvider><App /></AuthProvider></React.StrictMode>,
)
