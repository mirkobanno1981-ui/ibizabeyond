import React from 'react';

const PrivacyPolicy = () => {
    return (
        <div className="min-h-screen bg-background py-20 px-4">
            <div className="max-w-3xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                <header className="text-center space-y-4">
                    <h1 className="text-5xl font-black text-text-primary tracking-tighter uppercase">Política de Privacidad</h1>
                    <p className="text-primary text-[10px] font-black uppercase tracking-[0.5em] opacity-80">Ibiza Beyond • RGPD & LOPDGDD</p>
                </header>

                <div className="glass-card p-10 space-y-8 text-text-secondary leading-relaxed font-medium">
                    <section className="space-y-4">
                        <h2 className="text-xl font-black text-text-primary uppercase tracking-widest border-l-4 border-primary pl-4">1. Responsable del Tratamiento</h2>
                        <p>
                            De conformidad con el **Reglamento (UE) 2016/679 (RGPD)** y la **Ley Orgánica 3/2018 (LOPDGDD)**, le informamos que el responsable del tratamiento de sus datos es **Mirko Bannò**, con NIF **Y3194712A** e con sede in Ibiza, España.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-black text-text-primary uppercase tracking-widest border-l-4 border-primary pl-4">2. Finalidad del Tratamiento</h2>
                        <ul className="list-disc pl-5 space-y-2">
                            <li>Gestión del registro de usuarios y agentes en la plataforma.</li>
                            <li>Formalización de reservas de alojamiento de lujo.</li>
                            <li>Cumplimiento de obligaciones legales ante autoridades (reportes policiales según normativa vigente).</li>
                            <li>Comunicaciones comerciales si el usuario ha otorgado su consentimiento expreso.</li>
                        </ul>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-black text-text-primary uppercase tracking-widest border-l-4 border-primary pl-4">3. Base Jurídica</h2>
                        <p>
                            La base legal para el tratamiento es la ejecución del contrato de servicios (Art. 6.1.b RGPD) y el interés legítimo para la seguridad de la plataforma. Para el marketing, la base será el consentimiento (Art. 6.1.a RGPD).
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-black text-text-primary uppercase tracking-widest border-l-4 border-primary pl-4">4. Plazo de Conservación</h2>
                        <p>
                            Los datos se conservarán mientras se mantenga la relación contractual o durante los años necesarios para cumplir con las obligaciones legales (mínimo 5 años para transacciones financieras y registros turísticos).
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-black text-text-primary uppercase tracking-widest border-l-4 border-primary pl-4">5. Derechos</h2>
                        <p>
                            Usted tiene derecho a acceder, rectificar, suprimir, limitar el tratamiento, oponerse al mismo y a la portabilidad de sus datos enviando un correo a privacy@ibizabeyond.com.
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

export default PrivacyPolicy;
