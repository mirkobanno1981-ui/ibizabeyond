import React from 'react'
import VillasTable from './components/VillasTable'

function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar minimale */}
      <aside className="w-64 bg-dark-900 text-white flex flex-col hidden md:flex">
        <div className="p-6">
          <h1 className="text-2xl font-bold tracking-wider text-white">BEYOND<span className="text-primary-500">.</span></h1>
          <p className="text-xs text-gray-400 mt-2 uppercase tracking-widest">Agent Dashboard</p>
        </div>
        <nav className="flex-1 px-4 mt-8 space-y-2">
          <a href="#" className="flex items-center gap-3 px-4 py-3 bg-primary-600/10 text-primary-400 rounded-lg font-medium">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Our Villas
          </a>
          <a href="#" className="flex items-center gap-3 px-4 py-3 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors font-medium">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Quotes
          </a>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-screen">
        <header className="bg-white border-b border-gray-100 h-16 flex items-center justify-between px-8">
          <h2 className="text-lg font-semibold text-gray-800">Database Overview</h2>
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold text-sm">MB</div>
          </div>
        </header>

        <div className="p-8 flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900">Property Catalog</h1>
              <p className="text-gray-500 mt-2">Manage your synced villas from Invenio in real-time.</p>
            </div>

            {/* Il componente della Tabella che legge dal DB */}
            <VillasTable />

          </div>
        </div>
      </main>
    </div>
  )
}

export default App
