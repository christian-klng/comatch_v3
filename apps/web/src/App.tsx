import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { EventIntro } from './pages/EventIntro.js'
import { Join } from './pages/Join.js'
import { Landing } from './pages/Landing.js'
import { Play } from './pages/Play.js'

export function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/e/:slug" element={<EventIntro />} />
        <Route path="/e/:slug/join" element={<Join />} />
        <Route path="/e/:slug/play" element={<Play />} />
        {/* Wer sich verirrt, landet beim einzigen Hinweis, der ohne Event Sinn ergibt. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
