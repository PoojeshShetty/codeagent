import { useEffect } from "react"
import ChatInterface from "./components/ChatInterface"
import "./App.css"

function App() {
  useEffect(() => {
    fetch("http://localhost:4096/hello_world")
      .then((res) => res.json())
      .then((data) => console.log("Backend connection test:", data.message))
  }, [])

  return (
    <div>
      <ChatInterface />
    </div>
  )
}

export default App