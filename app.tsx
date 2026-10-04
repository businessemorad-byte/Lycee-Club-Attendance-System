import React from 'react';
import './app.css';
import { ServiceCallers } from './app.tsx';

function App() {
  return (
    <div className="app-container">
      <h1>Vercel Services Architecture Demo</h1>
      <ServiceCallers />
    </div>
  );
}

export default App;