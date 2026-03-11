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
                primary: '#e8ab30',
                'background-dark': '#0f1117',
                'background-light': '#f8f9fa',
                'surface-dark': '#1a1d26',
                'surface-dark2': '#22263a',
                'border-dark': 'rgba(232,171,48,0.15)',
            },
            fontFamily: {
                display: ['Manrope', 'Inter', 'sans-serif'],
            },
        },
    },
    plugins: [],
}
