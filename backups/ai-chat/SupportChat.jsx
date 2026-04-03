import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function SupportChat() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Ciao! Sono l\'Assistente AI di Ibiza Beyond. Come posso aiutarti oggi con la ricerca prodotti o le tue prenotazioni?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function handleSend(e) {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('ai-support', {
        body: { 
          message: userMessage, 
          history: messages.slice(-5), // Last 5 messages for context
          userId: user?.id 
        }
      });

      if (error) throw error;
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Mi dispiace, si è verificato un errore. Riprova più tardi.' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-4">
      {/* Chat Window */}
      {isOpen && (
        <div className="w-[380px] h-[550px] glass-card flex flex-col overflow-hidden border-primary/20 shadow-2xl animate-in slide-in-from-bottom-5 duration-300">
          {/* Header */}
          <div className="bg-primary/10 p-4 border-b border-primary/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="material-symbols-outlined notranslate text-primary text-2xl">smart_toy</span>
              </div>
              <div>
                <h3 className="text-sm font-black text-text-primary tracking-tight">AI Support Agent</h3>
                <div className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-green-500 animate-pulse"></span>
                  <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Online</span>
                </div>
              </div>
            </div>
            <button 
              onClick={() => setIsOpen(false)}
              className="size-8 rounded-full hover:bg-black/5 flex items-center justify-center transition-colors"
            >
              <span className="material-symbols-outlined notranslate text-xl">close</span>
            </button>
          </div>

          {/* Messages */}
          <div 
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth bg-white/1"
          >
            {messages.map((m, i) => (
              <div 
                key={i} 
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2`}
              >
                <div className={`max-w-[85%] rounded-2xl p-3 text-sm shadow-sm ${
                  m.role === 'user' 
                    ? 'bg-primary text-white rounded-br-none' 
                    : 'bg-surface-2 text-text-primary border border-white/5 rounded-bl-none'
                }`}>
                  <p className="leading-relaxed whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-surface-2 rounded-2xl p-4 flex gap-1 items-center rounded-bl-none border border-white/5">
                  <span className="size-1.5 rounded-full bg-text-muted/40 animate-bounce"></span>
                  <span className="size-1.5 rounded-full bg-text-muted/40 animate-bounce [animation-delay:0.2s]"></span>
                  <span className="size-1.5 rounded-full bg-text-muted/40 animate-bounce [animation-delay:0.4s]"></span>
                </div>
              </div>
            )}
          </div>

          {/* Input Area */}
          <form 
            onSubmit={handleSend}
            className="p-4 bg-surface-1 border-t border-white/5"
          >
            <div className="flex items-center gap-2 bg-background/50 rounded-xl p-2 border border-white/10 focus-within:border-primary/50 transition-all shadow-inner">
              <input 
                type="text"
                placeholder="Write a message..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="flex-1 bg-transparent border-none outline-none px-2 py-1 text-sm text-text-primary placeholder:text-text-muted/50"
              />
              <button 
                type="submit"
                disabled={!input.trim() || loading}
                className={`size-8 rounded-lg flex items-center justify-center transition-all ${
                  input.trim() && !loading ? 'bg-primary text-white shadow-lg' : 'bg-surface-2 text-text-muted'
                }`}
              >
                <span className="material-symbols-outlined notranslate text-lg">send</span>
              </button>
            </div>
            <p className="text-[9px] text-center text-text-muted mt-3 uppercase font-bold tracking-widest opacity-50">Powered by Ibiza Beyond AI</p>
          </form>
        </div>
      )}

      {/* Toggle Button */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={`size-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-500 hover:scale-110 active:scale-95 group ${
          isOpen ? 'bg-background text-text-primary rotate-90 border-2 border-primary/20' : 'bg-primary text-white'
        }`}
      >
        <span className="material-symbols-outlined notranslate text-2xl transition-transform group-hover:rotate-12">
          {isOpen ? 'close' : 'chat_bubble'}
        </span>
        {!isOpen && (
          <span className="absolute -top-1 -right-1 bg-red-500 border-2 border-white size-4 rounded-full flex items-center justify-center">
            <span className="size-2 bg-white rounded-full animate-ping"></span>
          </span>
        )}
      </button>
    </div>
  );
}
