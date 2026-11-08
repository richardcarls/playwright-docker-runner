import React from 'react';
import { createRoot } from 'react-dom/client';

function Counter() {
  const [count, setCount] = React.useState(0);

  return React.createElement('button', { onClick: () => setCount(count + 1) }, `Count ${count}`);
}

createRoot(document.getElementById('root')).render(React.createElement(Counter));
