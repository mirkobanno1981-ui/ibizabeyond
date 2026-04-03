/** @type {import('tailwindcss').Config} */
export default {
    darkMode: 'class',
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: 'var(--primary)',
                background: 'var(--background)',
                surface: 'var(--surface)',
                'surface-2': 'var(--surface-2)',
                border: 'var(--border)',
                'text-primary': 'var(--text-primary)',
                'text-secondary': 'var(--text-secondary)',
                'text-muted': 'var(--text-muted)',
                // Legacy support (mapping to new variables to avoid breaking things immediately)
                'background-dark': 'var(--background)',
                'surface-dark': 'var(--surface)',
                'surface-dark2': 'var(--surface-2)',
                'border-dark': 'var(--border)',
            },
            fontFamily: {
                display: ['Manrope', 'Inter', 'sans-serif'],
            },
        },
    },
    plugins: [],
}
