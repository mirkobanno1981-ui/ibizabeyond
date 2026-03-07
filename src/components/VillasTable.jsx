import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function VillasTable() {
    const [villas, setVillas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchVillas();
    }, []);

    async function fetchVillas() {
        try {
            setLoading(true);
            // Supponiamo che la tabella Supabase si chiami 'villas'
            const { data, error } = await supabase
                .from('villas')
                .select('*')
                .limit(10); // Carichiamo solo le prime 10 per iniziare

            if (error) {
                throw error;
            }

            if (data) {
                setVillas(data);
            }
        } catch (err) {
            console.error("Error fetching villas:", err.message);
            setError("Unable to load data from the database.");
        } finally {
            setLoading(false);
        }
    }

    if (loading) return <div className="p-4 text-center text-gray-500">Loading Ibiza's wonders...</div>;
    if (error) return <div className="p-4 text-center text-red-500 font-bold">{error}</div>;
    if (villas.length === 0) return <div className="p-4 text-center text-gray-500">No villas found. The database is empty or the table name is incorrect.</div>;

    return (
        <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden my-8">
            <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold tracking-tight text-gray-900">Villas Directory</h2>
                    <p className="text-sm text-gray-500 mt-1">Live preview of Supabase data for Ibiza Beyond B2B</p>
                </div>
                <button
                    onClick={fetchVillas}
                    className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                    Refresh Data
                </button>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-50/50">
                            <th className="px-6 py-4 border-b border-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-500">ID / Name</th>
                            <th className="px-6 py-4 border-b border-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-500">Base Price</th>
                            <th className="px-6 py-4 border-b border-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-500">Bedrooms / Baths</th>
                            <th className="px-6 py-4 border-b border-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-500 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {villas.map((villa) => (
                            <tr key={villa.id} className="hover:bg-gray-50/30 transition-colors">
                                <td className="px-6 py-4">
                                    <div className="font-medium text-gray-900">{villa.name || villa.title || 'No Name'}</div>
                                    <div className="text-xs text-gray-400 mt-1">ID: {villa.id}</div>
                                </td>
                                <td className="px-6 py-4">
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                        € {villa.price || villa.default_price || 'N/A'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-600">
                                    <span className="font-medium">{villa.bedrooms || 0}</span> beds • <span className="font-medium">{villa.bathrooms || 0}</span> baths
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <button className="text-primary-600 hover:text-primary-900 font-medium text-sm">
                                        Edit
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
