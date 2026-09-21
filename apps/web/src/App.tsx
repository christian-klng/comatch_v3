import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { EventShell } from './EventShell.js'
import { I18nProvider } from './i18n/I18nProvider.js'
import { EventIntro } from './pages/EventIntro.js'
import { Join } from './pages/Join.js'
import { Landing } from './pages/Landing.js'
import { Play } from './pages/Play.js'
import { EventThemeProvider } from './theme/EventThemeProvider.js'

export function App(): React.ReactElement {
  return (
    <I18nProvider>
      <EventThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/e/:slug" element={<EventShell />}>
              <Route index element={<EventIntro />} />
              <Route path="join" element={<Join />} />
              <Route path="play" element={<Play />} />
            </Route>
            {/* Wer sich verirrt, landet beim einzigen Hinweis, der ohne Event Sinn ergibt. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </EventThemeProvider>
    </I18nProvider>
  )
}
