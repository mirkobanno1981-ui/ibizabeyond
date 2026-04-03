import React from 'react';

const STATUS_CONFIG = {
    draft: { 
        label: 'Lead/Draft', 
        icon: 'draft', 
        color: 'text-slate-400', 
        bg: 'bg-slate-500/10', 
        border: 'border-slate-500/20' 
    },
    sent: { 
        label: 'Proposal Sent', 
        icon: 'send', 
        color: 'text-blue-400', 
        bg: 'bg-blue-500/10', 
        border: 'border-blue-500/20' 
    },
    booked: { 
        label: 'Reservation Booked', 
        icon: 'check_circle', 
        color: 'text-emerald-400', 
        bg: 'bg-emerald-500/10', 
        border: 'border-emerald-500/20' 
    },
    check_in_ready: {
        label: 'Data Received',
        icon: 'how_to_reg',
        color: 'text-purple-400',
        bg: 'bg-purple-500/10',
        border: 'border-purple-500/20'
    },
    completed: {
        label: 'Completed',
        icon: 'task_alt',
        color: 'text-amber-400',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/20'
    },
    cancelled: { 
        label: 'Cancelled', 
        icon: 'cancel', 
        color: 'text-red-400', 
        bg: 'bg-red-500/10', 
        border: 'border-red-500/20' 
    },
    expired: {
        label: 'Expired',
        icon: 'history',
        color: 'text-slate-500',
        bg: 'bg-slate-500/5',
        border: 'border-slate-500/10'
    },
    waiting_owner: {
        label: 'Waiting Owner',
        icon: 'hourglass_empty',
        color: 'text-amber-400',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/20'
    },
    owner_declined: {
        label: 'Owner Declined',
        icon: 'block',
        color: 'text-rose-400',
        bg: 'bg-rose-500/10',
        border: 'border-rose-500/20'
    },
    details_requested: {
        label: 'Details Requested',
        icon: 'contact_support',
        color: 'text-cyan-400',
        bg: 'bg-cyan-500/10',
        border: 'border-cyan-500/20'
    },
    contract_sent: {
        label: 'Contract Sent',
        icon: 'draw',
        color: 'text-indigo-400',
        bg: 'bg-indigo-500/10',
        border: 'border-indigo-500/20'
    },
    contract_signed: {
        label: 'Contract Signed',
        icon: 'verified',
        color: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/30'
    }
};

const QuoteCard = ({ quote, onEdit, onAssign, onDelete, onDownloadPDF, onShare, onWhatsAppShare, onAskAvailability, role }) => {
    const config = STATUS_CONFIG[quote.status] || STATUS_CONFIG.draft;
    
    const handleDragStart = (e) => {
        e.dataTransfer.setData('quoteId', quote.id);
        e.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div 
            draggable="true"
            onDragStart={handleDragStart}
            className="glass-card p-4 space-y-3 group hover:border-primary/40 transition-all animate-in fade-in zoom-in duration-300 cursor-grab active:cursor-grabbing relative overflow-hidden"
        >
            {quote.ses_status === 'sent' ? (
                <div className="absolute top-0 right-0 px-2 py-0.5 bg-emerald-500 text-[8px] font-black text-white uppercase tracking-widest rounded-bl-lg flex items-center gap-1">
                    <span className="material-symbols-outlined notranslate text-[10px]">gavel</span>
                    SES Reported
                </div>
            ) : quote.guest_form_filled ? (
                <div className="absolute top-0 right-0 px-2 py-0.5 bg-purple-500 text-[8px] font-black text-white uppercase tracking-widest rounded-bl-lg flex items-center gap-1">
                    <span className="material-symbols-outlined notranslate text-[10px]">how_to_reg</span>
                    Data Received
                </div>
            ) : null}
            
            <div className="flex justify-between items-start gap-2">
                <h4 className="font-bold text-[13px] text-text-primary leading-tight line-clamp-2">{quote.invenio_properties?.villa_name || 'Unnamed Villa'}</h4>
                <div className={`size-6 rounded-lg ${config.bg} flex items-center justify-center ${config.color} shrink-0`}>
                    <span className="material-symbols-outlined notranslate text-[16px]">{config.icon}</span>
                </div>
            </div>
            
            <div className="space-y-1">
                <p className="text-[11px] text-text-secondary font-semibold flex items-center gap-1.5">
                    <span className="material-symbols-outlined notranslate text-[14px]">person</span>
                    {quote.clients?.full_name || 'Guest'}
                </p>
                <div className="flex items-center justify-between">
                    <p className="text-[10px] text-text-muted flex items-center gap-1.5 font-medium">
                        <span className="material-symbols-outlined notranslate text-[14px]">calendar_month</span>
                        {new Date(quote.check_in).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </p>
                    <p className="font-black text-primary text-[12px]">€{parseFloat(quote.final_price || 0).toLocaleString()}</p>
                </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <div className="flex items-center gap-1">
                    <button onClick={() => onEdit(quote)} className="p-1 text-text-muted hover:text-primary transition-colors" title="Edit Quote"><span className="material-symbols-outlined notranslate text-[16px]">edit</span></button>
                    {(role === 'admin' || role === 'super_admin') && (
                        <button onClick={() => onAssign(quote)} className="p-1 text-text-muted hover:text-primary transition-colors" title="Assign Agent"><span className="material-symbols-outlined notranslate text-[16px]">person_add</span></button>
                    )}
                    <button onClick={() => onDownloadPDF(quote)} className="p-1 text-text-muted hover:text-primary transition-colors" title="Download PDF"><span className="material-symbols-outlined notranslate text-[16px]">picture_as_pdf</span></button>
                </div>
                <div className="flex items-center gap-1">
                    <button 
                        onClick={() => onWhatsAppShare(quote)} 
                        className="p-1 text-text-muted hover:text-[#25D366] transition-colors" 
                        title="Share via WhatsApp"
                    >
                        <svg className="size-3.5 fill-current" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.72.94 3.659 1.437 5.634 1.437h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    </button>
                    <button onClick={() => onShare(quote)} className="p-1 text-text-muted hover:text-primary transition-colors" title="Share link"><span className="material-symbols-outlined notranslate text-[16px]">share</span></button>
                    <button onClick={() => onDelete(quote.id)} className="p-1 text-text-muted hover:text-red-400 transition-colors" title="Delete Quote"><span className="material-symbols-outlined notranslate text-[16px]">delete</span></button>
                    {(quote.status === 'draft' || quote.status === 'details_requested' || quote.status === 'waiting_owner') && (quote.invenio_properties?.owner_id || quote.invenio_boats?.owner_id) && (
                        <button 
                            onClick={() => onAskAvailability(quote)}
                            className="p-1 text-amber-500 hover:text-amber-400 transition-colors" 
                            title="Ask Owner Availability (WhatsApp)"
                        >
                            <span className="material-symbols-outlined notranslate text-[16px]">chat</span>
                        </button>
                    )}
                    {['draft', 'sent', 'owner_approved', 'waiting_owner'].includes(quote.status) && !quote.documenso_document_id && (
                        <button 
                            onClick={async () => {
                                if (confirm('Generate and send B2B contract via Documenso?')) {
                                    try {
                                        const { supabase } = await import('../lib/supabase');
                                        const { data, error } = await supabase.functions.invoke('documenso-contract', {
                                            body: { quoteId: quote.id }
                                        });
                                        if (error) throw error;
                                        if (data?.error) throw new Error(data.error);
                                        onStatusChange(quote.id, 'contract_sent');
                                        alert('Contract generated and sent successfully!');
                                    } catch(err) {
                                        alert('Error generating contract: ' + err.message);
                                    }
                                }
                            }}
                            className="p-1 text-indigo-500 hover:text-indigo-400 transition-colors"
                            title="Generate & Send B2B Contract"
                        >
                            <span className="material-symbols-outlined notranslate text-[16px]">draw</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default function QuotesKanban({ quotes, onEdit, onAssign, onDelete, onDownloadPDF, onShare, onWhatsAppShare, onAskAvailability, onStatusChange, role }) {
    const statuses = ['draft', 'waiting_owner', 'details_requested', 'sent', 'owner_declined', 'contract_sent', 'contract_signed', 'booked', 'check_in_ready', 'completed', 'cancelled'];
    
    const columns = statuses.reduce((acc, status) => {
        acc[status] = quotes.filter(q => q.status === status);
        return acc;
    }, {});

    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e, targetStatus) => {
        e.preventDefault();
        const quoteId = e.dataTransfer.getData('quoteId');
        if (quoteId) {
            onStatusChange(quoteId, targetStatus);
        }
    };

    return (
        <div className="flex gap-6 overflow-x-auto pb-8 snap-x min-h-[700px]">
            {statuses.map(status => {
                const config = STATUS_CONFIG[status];
                const columnQuotes = columns[status] || [];
                
                return (
                    <div 
                        key={status} 
                        className="flex flex-col gap-4 min-w-[280px] w-[280px] snap-start"
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, status)}
                    >
                        <div className="flex items-center justify-between px-2">
                            <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${config.color}`}>{config.label}</span>
                                <span className="bg-surface-2 text-text-muted text-[10px] px-1.5 py-0.5 rounded-md font-bold">{columnQuotes.length}</span>
                            </div>
                        </div>
                        
                        <div className="flex-1 bg-surface-2/30 rounded-2xl p-3 space-y-4 border border-border/50 transition-colors hover:bg-surface-2/40">
                            {columnQuotes.map(quote => (
                                <QuoteCard 
                                    key={quote.id} 
                                    quote={quote} 
                                    onEdit={onEdit} 
                                    onAssign={onAssign}
                                    onDelete={onDelete} 
                                    onDownloadPDF={onDownloadPDF} 
                                    onShare={onShare}
                                    onAskAvailability={onAskAvailability}
                                    role={role}
                                />
                            ))}
                            {columnQuotes.length === 0 && (
                                <div className="h-32 flex items-center justify-center border-2 border-dashed border-border/20 rounded-2xl">
                                    <p className="text-[10px] text-text-muted uppercase font-black tracking-widest opacity-40">Empty</p>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
