import React from 'react';

const TermsAndConditions = () => {
    return (
        <div className="min-h-screen bg-background py-20 px-4">
            <div className="max-w-3xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                <header className="text-center space-y-4">
                    <h1 className="text-5xl font-black text-text-primary tracking-tighter uppercase">Términos y Condiciones</h1>
                    <p className="text-primary text-[10px] font-black uppercase tracking-[0.5em] opacity-80">Ibiza Beyond • Aviso Legal & Condiciones de Uso</p>
                </header>

                <div className="glass-card p-10 space-y-8 text-text-secondary leading-relaxed font-medium">
                    <section className="space-y-4">
                        <h2 className="text-xl font-black text-text-primary uppercase tracking-widest border-l-4 border-primary pl-4">1. Aviso Legal (LSSI-CE)</h2>
                        <p>
                            En cumplimiento del **Artículo 10 de la Ley 34/2002 (LSSI-CE)**, informamos que esta plataforma es operada por **Mirko Bannò**, provisto de NIF **Y3194712A** e con sede in Ibiza, Islas Baleares.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-black text-text-primary uppercase tracking-widest border-l-4 border-primary pl-4">2. Objeto de la Plataforma</h2>
                        <p>
                            Ibiza Beyond es un software de gestión para propiedades de lujo ("Villas") destinado a agentes e intermediarios. El uso de la plataforma implica la aceptación de estas condiciones.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-black text-text-primary uppercase tracking-widest border-l-4 border-primary pl-4">3. Proceso de Reserva y Pago</h2>
                        <p>
                            Las reservas se formalizan mediante pasarela de pago segura (Stripe). Los agentes son responsables de verificar la exactitud de los datos del cliente final. El contrato se considera perfeccionado en el momento de la confirmación del pago.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-black text-text-primary uppercase tracking-widest border-l-4 border-primary pl-4">4. Propiedad Intelectual</h2>
                        <p>
                            Todo el contenido, incluyendo fotografías de villas y software, es propiedad de **Mirko Bannò** o cuenta con las licencias correspondientes. Queda prohibida la reproducción total o parcial sin autorización expresa.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-black text-text-primary uppercase tracking-widest border-l-4 border-primary pl-4">5. Derecho de Desistimiento (LGDCU)</h2>
                        <p>
                            De acuerdo con el **Real Decreto Legislativo 1/2007 (LGDCU)**, informamos que los servicios de alojamiento de fecha determinada están exceptuados del derecho de desistimiento una vez confirmados. Las políticas de cancelación detalladas en cada reserva prevalecerán sobre cualquier disposición general.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-black text-text-primary uppercase tracking-widest border-l-4 border-primary pl-4">6. Alquiler de Embarcaciones (Boat Charter)</h2>
                        <p>
                            Las reservas de charter náutico están sujetas a la normativa balear vigente. El precio incluye el seguro obligatorio y la tripulación (si se especifica). El **combustible** no está incluido salvo indicación contraria y se liquidará al finalizar el servicio según consumo. Es responsabilidad del arrendatario cumplir con las normas de seguridad a bordo y las instrucciones del patrón.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-black text-text-primary uppercase tracking-widest border-l-4 border-primary pl-4">7. Jurisdicción Aplicable</h2>
                        <p>
                            Cualquier controversia se someterá a los Juzgados y Tribunales de la ciudad de Eivissa (Ibiza), con renuncia expresa a cualquier otro fuero que pudiera corresponder.
                        </p>
                    </section>
                </div>

                <footer className="text-center">
                    <button onClick={() => window.history.back()} className="btn-primary px-8">Volver</button>
                </footer>
            </div>
        </div>
    );
};

export default TermsAndConditions;
