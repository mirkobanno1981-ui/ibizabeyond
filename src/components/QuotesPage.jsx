import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const STATUS_COLORS = {
    draft: 'bg-slate-500/20 text-slate-400',
    sent: 'bg-blue-500/20 text-blue-400',
    booked: 'bg-green-500/20 text-green-400',
    cancelled: 'bg-red-500/20 text-red-400',
};

const EditQuoteModal = ({ quote, onClose, onSaved }) => {
    const [margin, setMargin] = useState(quote.agent_markup || 15);
    const [extraServices, setExtraServices] = useState(quote.extra_services || []);
    const [manualPrice, setManualPrice] = useState(quote.final_price || 0);
    const [isManual, setIsManual] = useState(quote.is_manual_price || false);
    const [saving, setSaving] = useState(false);

    const addService = () => setExtraServices([...extraServices, { name: '', price: 0 }]);
    const removeService = (idx) => setExtraServices(extraServices.filter((_, i) => i !== idx));
    const updateService = (idx, field, val) => {
        const newServices = [...extraServices];
        newServices[idx][field] = field === 'price' ? parseFloat(val) || 0 : val;
        setExtraServices(newServices);
    };

    const calculateAutoPrice = () => {
        const base = parseFloat(quote.supplier_base_price || 0);
        const adminMarkup = parseFloat(quote.admin_markup || 0);
        const agentMarkup = parseFloat(margin || 0);
        
        const priceWithAdmin = base * (1 + adminMarkup / 100);
        const priceWithAgent = priceWithAdmin * (1 + agentMarkup / 100);
        
        const extraTotal = extraServices.reduce((sum, s) => sum + (s.price || 0), 0);
        return Math.round(priceWithAgent + extraTotal);
    };

    useEffect(() => {
        if (!isManual) {
            setManualPrice(calculateAutoPrice());
        }
    }, [margin, extraServices, isManual]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const finalPrice = isManual ? manualPrice : calculateAutoPrice();
            const { error } = await supabase
                .from('quotes')
                .update({
                    agent_markup: margin,
                    extra_services: extraServices,
                    final_price: finalPrice,
                    is_manual_price: isManual
                })
                .eq('id', quote.id);

            if (error) throw error;
            onSaved();
        } catch (err) {
            alert('Error updating quote: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <div className="bg-surface-dark border border-border-dark rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in duration-200">
                <div className="p-6 border-b border-border-dark flex justify-between items-center">
                    <h2 className="text-xl font-bold text-white">Edit Quote Details</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                    {/* Margin */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Agent Margin (%)</label>
                        <div className="relative">
                            <input 
                                type="number" 
                                value={margin}
                                onChange={e => setMargin(e.target.value)}
                                disabled={isManual}
                                className="w-full input-dark py-2.5 text-right font-bold text-primary disabled:opacity-50"
                            />
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-600">%</span>
                        </div>
                    </div>

                    {/* Extra Services */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Extra Services</label>
                            <button onClick={addService} className="text-[10px] font-bold text-primary uppercase hover:underline flex items-center gap-1">
                                <span className="material-symbols-outlined text-sm">add</span> Add Service
                            </button>
                        </div>
                        <div className="space-y-2">
                            {extraServices.map((s, idx) => (
                                <div key={idx} className="flex gap-2 items-center bg-background-dark/50 p-2 rounded-xl border border-border-dark animate-in slide-in-from-right-2">
                                    <input 
                                        placeholder="Service name (e.g. Car Rental)"
                                        className="flex-1 bg-transparent border-none text-sm text-slate-200 outline-none"
                                        value={s.name}
                                        onChange={e => updateService(idx, 'name', e.target.value)}
                                    />
                                    <div className="relative w-24">
                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-600">€</span>
                                        <input 
                                            type="number"
                                            placeholder="0"
                                            className="w-full bg-transparent border-none text-sm text-right text-primary font-bold outline-none"
                                            value={s.price}
                                            onChange={e => updateService(idx, 'price', e.target.value)}
                                        />
                                    </div>
                                    <button onClick={() => removeService(idx)} className="text-slate-600 hover:text-red-400 p-1">
                                        <span className="material-symbols-outlined text-sm">delete</span>
                                    </button>
                                </div>
                            ))}
                            {extraServices.length === 0 && <p className="text-xs text-slate-600 italic">No extra services added.</p>}
                        </div>
                    </div>

                    {/* Final Price & Override */}
                    <div className="pt-4 border-t border-border-dark space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total Price (EUR)</label>
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <span className="text-[10px] font-bold text-slate-600 uppercase group-hover:text-primary transition-colors">Manual Override</span>
                                <input 
                                    type="checkbox" 
                                    checked={isManual}
                                    onChange={e => setIsManual(e.target.checked)}
                                    className="accent-primary"
                                />
                            </label>
                        </div>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-primary/30">€</span>
                            <input 
                                type="number"
                                value={isManual ? manualPrice : calculateAutoPrice()}
                                onChange={e => setManualPrice(e.target.value)}
                                readOnly={!isManual}
                                className={`w-full bg-primary/5 border-2 ${isManual ? 'border-primary' : 'border-primary/20'} rounded-2xl py-6 px-10 text-3xl font-black text-primary outline-none transition-all`}
                            />
                        </div>
                        <p className="text-[10px] text-slate-500 italic text-center">
                            {isManual ? 'Warning: Automatic calculations are suspended in manual mode.' : 'Calculated automatically based on subtotal, margin, and extras.'}
                        </p>
                    </div>
                </div>

                <div className="p-6 bg-background-dark/30 flex gap-3">
                    <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-border-dark text-slate-400 font-bold hover:bg-white/5 transition-all text-sm">Cancel</button>
                    <button 
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-[2] btn-primary py-3 font-bold shadow-lg shadow-primary/20 disabled:opacity-50 text-sm"
                    >
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default function QuotesPage() {
    const { user } = useAuth();
    const [quotes, setQuotes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editQuote, setEditQuote] = useState(null);

    useEffect(() => { 
        if (user) fetchQuotes(); 
    }, [user]);

    async function fetchQuotes() {
        setLoading(true);
        const { data } = await supabase
            .from('quotes')
            .select(`
                id, status, check_in, check_out, final_price, created_at,
                client_id,
                agent_id,
                agent_markup,
                extra_services,
                is_manual_price,
                supplier_base_price,
                admin_markup,
                clients(full_name, phone_number),
                invenio_properties(*)
            `)
            .eq('agent_id', user.id)
            .order('created_at', { ascending: false });
        setQuotes(data || []);
        setLoading(false);
    }

    const generatePDF = async (quote) => {
        const { data: agent } = await supabase
            .from('agents')
            .select('*')
            .eq('id', user.id)
            .single();

        const doc = new jsPDF('p', 'mm', 'a4');
        const villa = quote.invenio_properties;
        
        // Header
        doc.setFillColor(15, 23, 42); // bg-background-dark
        doc.rect(0, 0, 210, 40, 'F');
        
        if (agent?.logo_url) {
            try {
                const img = new Image();
                img.src = agent.logo_url;
                await new Promise(r => img.onload = r);
                doc.addImage(img, 'PNG', 15, 10, 20, 20);
            } catch (e) {
                doc.setTextColor(255, 255, 255);
                doc.text('✦', 15, 22);
            }
        }

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(agent?.company_name || 'Ibiza Beyond', 40, 20);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text(agent?.phone_number || '', 40, 26);

        // Client & Villa Title
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text(villa?.villa_name || 'Villa Proposal', 15, 60);
        
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text('Presented to:', 15, 70);
        doc.setTextColor(0, 0, 0);
        doc.text(quote.clients?.full_name || 'Valued Client', 40, 70);

        // Details Table
        doc.setDrawColor(230, 230, 230);
        doc.line(15, 80, 195, 80);

        const details = [
            ['Dates', `${new Date(quote.check_in).toLocaleDateString()} to ${new Date(quote.check_out).toLocaleDateString()}`],
            ['Location', villa?.district || 'Ibiza'],
            ['Bedrooms', villa?.bedrooms?.toString() || '—'],
            ['Total Price', `EUR ${parseFloat(quote.final_price).toLocaleString()}`]
        ];

        let y = 90;
        details.forEach(([label, value]) => {
            doc.setFont('helvetica', 'bold');
            doc.text(label, 15, y);
            doc.setFont('helvetica', 'normal');
            doc.text(value, 60, y);
            y += 10;
        });

        // Extra Services
        if (quote.extra_services && quote.extra_services.length > 0) {
            y += 5;
            doc.setFont('helvetica', 'bold');
            doc.text('Extra Services', 15, y);
            y += 7;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            quote.extra_services.forEach(s => {
                doc.text(s.name, 15, y);
                doc.text(`EUR ${parseFloat(s.price).toLocaleString()}`, 195, y, { align: 'right' });
                y += 6;
            });
        }

        // About
        y += 10;
        doc.setFont('helvetica', 'bold');
        doc.text('About the Property', 15, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        const splitText = doc.splitTextToSize(villa?.description || 'Exclusive luxury villa in Ibiza.', 180);
        doc.text(splitText, 15, y);

        // Footer
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(`Generated on ${new Date().toLocaleDateString()} | ${agent?.company_name || 'Ibiza Beyond'}`, 105, 285, { align: 'center' });

        doc.save(`Quote_${villa?.villa_name.replace(/\s+/g, '_')}_${quote.id.slice(0, 8)}.pdf`);
    };

    return (
        <div className="p-6 md:p-8 space-y-6">
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Quotes</h1>
                    <p className="text-slate-500 text-sm mt-0.5">{quotes.length} quote{quotes.length !== 1 ? 's' : ''} issued</p>
                </div>
                {/* <button className="btn-primary text-sm flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    New Quote
                </button> */}
            </div>

            <div className="glass-card overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center">
                        <div className="animate-spin inline-block size-6 border-2 border-primary border-t-transparent rounded-full"></div>
                    </div>
                ) : quotes.length === 0 ? (
                    <div className="p-12 text-center text-slate-500">
                        <span className="material-symbols-outlined text-4xl block mb-2 text-slate-700">request_quote</span>
                        No quotes yet. Create your first quote above.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border-dark">
                                    <th className="text-left text-xs text-slate-500 font-semibold px-5 py-3 uppercase tracking-wider">Villa</th>
                                    <th className="text-left text-xs text-slate-500 font-semibold px-5 py-3 uppercase tracking-wider">Client</th>
                                    <th className="text-left text-xs text-slate-500 font-semibold px-5 py-3 uppercase tracking-wider">Dates</th>
                                    <th className="text-right text-xs text-slate-500 font-semibold px-5 py-3 uppercase tracking-wider">Price</th>
                                    <th className="text-left text-xs text-slate-500 font-semibold px-5 py-3 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border-dark">
                                {quotes.map(q => (
                                    <tr key={q.id} className="hover:bg-white/2 transition-colors">
                                        <td className="px-5 py-3.5 font-medium text-white max-w-[180px] truncate">
                                            {q.invenio_properties?.villa_name || '—'}
                                        </td>
                                        <td className="px-5 py-3.5 text-slate-300">{q.clients?.full_name || '—'}</td>
                                        <td className="px-5 py-3.5 text-slate-400 text-xs">
                                            {q.check_in ? `${new Date(q.check_in).toLocaleDateString('en-GB')} → ${new Date(q.check_out).toLocaleDateString('en-GB')}` : '—'}
                                        </td>
                                        <td className="px-5 py-3.5 text-right text-primary font-bold">
                                            {q.final_price ? `€${parseFloat(q.final_price).toLocaleString()}` : '—'}
                                            {q.is_manual_price && <span className="block text-[8px] text-slate-500 uppercase tracking-tighter">Manual Override</span>}
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <div className="flex items-center gap-2">
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide mr-2 ${STATUS_COLORS[q.status] || ''}`}>
                                                    {q.status}
                                                </span>
                                                <button 
                                                    onClick={() => setEditQuote(q)}
                                                    className="size-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-slate-500 hover:text-primary transition-all group"
                                                    title="Edit Quote"
                                                >
                                                    <span className="material-symbols-outlined text-[16px] group-hover:scale-110">edit</span>
                                                </button>
                                                <button 
                                                    onClick={() => {
                                                        const url = `${window.location.origin}/quote/${q.id}`;
                                                        navigator.clipboard.writeText(url);
                                                        alert('Public link copied to clipboard!');
                                                    }}
                                                    className="size-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-slate-500 hover:text-primary transition-all group"
                                                    title="Copy public link"
                                                >
                                                    <span className="material-symbols-outlined text-[16px] group-hover:scale-110">share</span>
                                                </button>
                                                <button 
                                                    onClick={() => generatePDF(q)}
                                                    className="size-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-slate-500 hover:text-primary transition-all group"
                                                    title="Download PDF"
                                                >
                                                    <span className="material-symbols-outlined text-[16px] group-hover:scale-110">picture_as_pdf</span>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {editQuote && (
                <EditQuoteModal 
                    quote={editQuote} 
                    onClose={() => setEditQuote(null)} 
                    onSaved={() => {
                        setEditQuote(null);
                        fetchQuotes();
                    }}
                />
            )}
        </div>
    );
}
