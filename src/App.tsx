import { Navigate, Route, Routes } from 'react-router-dom'
import { Home } from './pages/Home'
import { Admin } from './pages/Admin'
import { Viewer } from './pages/Viewer'
import { Collector } from './pages/Collector'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/viewer" element={<Viewer />} />
      <Route path="/collector" element={<Collector />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
