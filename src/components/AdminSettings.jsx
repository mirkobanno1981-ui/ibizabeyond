import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function AdminSettings() {
    const [invenioToAdmin, setInvenioToAdmin] = useState('');
    const [adminToAgent, setAdminToAgent] = useState('');
    const [sesUser, setSesUser] = useState('');
    const [sesPassword, setSesPassword] = useState('');
    const [villasEnabled, setVillasEnabled] = useState(true);
    const [boatsEnabled, setBoatsEnabled] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState({ text: '', type: '' });
    const { role } = useAuth();

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('margin_settings')
                .select('*')
                .limit(1)
                .single();

            if (error) throw error;

            if (data) {
                setInvenioToAdmin(data.invenio_to_admin_margin);
                setAdminToAgent(data.admin_to_agent_margin);
            }

            // Fetch technical settings from global_settings
            const { data: globalData } = await supabase
                .from('global_settings')
                .select('*')
                .single();
            if (globalData) {
                setSesUser(globalData.ses_user || '');
                setSesPassword(globalData.ses_password || '');
                setVillasEnabled(globalData.villas_enabled ?? true);
                setBoatsEnabled(globalData.boats_enabled ?? true);
            }
        } catch (error) {
            console.error("Error fetching margin settings:", error);
            setMessage({ text: 'Unable to load settings.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setMessage({ text: '', type: '' });

        try {
            const { error } = await supabase
                .from('margin_settings')
                .update({
                    invenio_to_admin_margin: parseFloat(invenioToAdmin) || 0,
                    admin_to_agent_margin: parseFloat(adminToAgent) || 0
                })
                .eq('id', 1); // Assuming single row setup

            if (error) throw error;

            // Save technical settings to global_settings
            const { error: globalError } = await supabase
                .from('global_settings')
                .update({
                    ses_user: sesUser,
                    ses_password: sesPassword,
                    villas_enabled: villasEnabled,
                    boats_enabled: boatsEnabled
                })
                .eq('id', (await supabase.from('global_settings').select('id').single()).data?.id);

            if (globalError) throw globalError;
            setMessage({ text: 'Settings saved successfully!', type: 'success' });

            // Auto hide success message
            setTimeout(() => {
                setMessage({ text: '', type: '' });
            }, 3000);
        } catch (error) {
            console.error("Error saving settings:", error);
            setMessage({ text: 'Error saving settings.', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="text-text-muted">Loading settings...</div>;
    }

    return (
        <div className="max-w-xl mx-auto space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="bg-primary/10 p-2 rounded-lg">
                    <span className="material-symbols-outlined notranslate text-primary">settings</span>
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-text-primary">Global Margin Settings</h2>
            </div>

            {message.text && (
                <div className={`p-4 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                    {message.text}
                </div>
            )}

            <section className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-slate-800 dark:text-text-primary">Financial Settings</h3>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
                    <div className="space-y-6">

                        <div className="space-y-2">
                            <label className="block text-sm font-semibold text-slate-700 dark:text-text-secondary">
                                Property Cost to Admin Margin
                            </label>
                            <div className="relative flex items-center">
                                <input
                                    className="w-full h-14 rounded-lg border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-lg font-medium focus:border-primary focus:ring-primary dark:text-text-primary pr-12 pl-4 outline-none"
                                    placeholder="0.00"
                                    type="number"
                                    step="0.01"
                                    value={invenioToAdmin}
                                    onChange={(e) => setInvenioToAdmin(e.target.value)}
                                />
                                <div className="absolute right-4 pointer-events-none">
                                    <span className="material-symbols-outlined notranslate text-text-muted dark:text-text-muted">percent</span>
                                </div>
                            </div>
                            <p className="text-xs text-text-muted dark:text-text-muted leading-relaxed italic">
                                Added to the base property cost price. Used to calculate the internal Admin cost.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="block text-sm font-semibold text-slate-700 dark:text-text-secondary">
                                Admin to Agent Margin
                            </label>
                            <div className="relative flex items-center">
                                <input
                                    className="w-full h-14 rounded-lg border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-lg font-medium focus:border-primary focus:ring-primary dark:text-text-primary pr-12 pl-4 outline-none"
                                    placeholder="0.00"
                                    type="number"
                                    step="0.01"
                                    value={adminToAgent}
                                    onChange={(e) => setAdminToAgent(e.target.value)}
                                />
                                <div className="absolute right-4 pointer-events-none">
                                    <span className="material-symbols-outlined notranslate text-text-muted dark:text-text-muted">percent</span>
                                </div>
                            </div>
                            <p className="text-xs text-text-muted dark:text-text-muted leading-relaxed italic">
                                Added to the Admin cost. This determines the final price displayed to Agents.
                            </p>
                        </div>

                        <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="w-full bg-primary hover:bg-primary/90 text-background-dark font-bold py-4 rounded-xl shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                <span className="material-symbols-outlined notranslate text-[20px]">save</span>
                                {saving ? "Saving..." : "Save Settings"}
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            <section className="space-y-4 pt-8">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-slate-800 dark:text-text-primary">SES Ministerio del Interior</h3>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <label className="block text-sm font-semibold text-slate-700 dark:text-text-secondary">
                                SES User (Identificador)
                            </label>
                            <input
                                className="w-full h-12 rounded-lg border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:border-primary outline-none px-4"
                                placeholder="SES User ID"
                                value={sesUser}
                                onChange={(e) => setSesUser(e.target.value)}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="block text-sm font-semibold text-slate-700 dark:text-text-secondary">
                                SES Password
                            </label>
                            <input
                                type="password"
                                className="w-full h-12 rounded-lg border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:border-primary outline-none px-4"
                                placeholder="••••••••"
                                value={sesPassword}
                                onChange={(e) => setSesPassword(e.target.value)}
                            />
                        </div>

                        <p className="text-[10px] text-text-muted italic">
                            These credentials are used by the Edge Function to transmit guest data to the Spanish Ministry of Interior (RD 933/2021).
                        </p>
                    </div>
                </div>
            </section>

            {role === 'super_admin' && (
                <section className="space-y-4 pt-8">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-text-primary">Feature Management</h3>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
                        <div className="space-y-6">
                            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                                <div>
                                    <p className="text-sm font-semibold text-slate-700 dark:text-text-secondary">Enable Villas</p>
                                    <p className="text-[10px] text-text-muted">Global switch for villa inventory and bookings.</p>
                                </div>
                                <button
                                    onClick={() => setVillasEnabled(!villasEnabled)}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${villasEnabled ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-700'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${villasEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>

                            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                                <div>
                                    <p className="text-sm font-semibold text-slate-700 dark:text-text-secondary">Enable Boats</p>
                                    <p className="text-[10px] text-text-muted">Global switch for boat charter and fleet management.</p>
                                </div>
                                <button
                                    onClick={() => setBoatsEnabled(!boatsEnabled)}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${boatsEnabled ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-700'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${boatsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>
                    </div>
                </section>
            )}
        </div>
    );
}
