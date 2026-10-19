import { createContext, useContext } from 'react'

/** Everything a page needs from the app shell: shared data, setters, navigation and toasts. */
export const AppContext = createContext(null)

export const useApp = () => useContext(AppContext)
