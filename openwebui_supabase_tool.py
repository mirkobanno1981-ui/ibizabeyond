"""
title: Supabase Ibiza Beyond Agent Tool
author: Developer
description: Permette all'agente di cercare ville e barche interagendo in tempo reale col database di Supabase. Aggiungi questo file ai tuoi Tools in Workspace.
version: 1.0.0
"""

import requests
from pydantic import BaseModel, Field

class Tools:
    class Valves(BaseModel):
        SUPABASE_URL: str = Field(
            default="https://nqnwmotrjlbqdnrwcyfz.supabase.co", 
            description="L'URL del progetto Supabase."
        )
        SUPABASE_KEY: str = Field(
            default="INCOLLA_QUI_LA_TUA_CHIAVE_SUPABASE", 
            description="La chiave ANON o SERVICE_ROLE di Supabase. Trovi la ANON KEY nel tuo file .env.local come VITE_SUPABASE_ANON_KEY"
        )

    def __init__(self):
        self.valves = self.Valves()

    def _get_headers(self) -> dict:
        return {
            "apikey": self.valves.SUPABASE_KEY,
            "Authorization": f"Bearer {self.valves.SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }

    def cerca_ville(self, limite: int = 5, camere_minime: int = None) -> str:
        """
        Cerca ville disponibili nel database in base a richieste specifiche dell'utente. Usa questo ogni volta che ti chiedono consigli sulle ville.
        
        :param limite: Numero massimo di risultati da trovare (consigliato: 5).
        :param camere_minime: Se l'utente chiede un numero specifico di camere, indica il limite inferiore.
        :return: Lista di ville formattata in markdown, o errore.
        """
        url = f"{self.valves.SUPABASE_URL}/rest/v1/invenio_properties"
        
        params = {
            "select": "villa_name, bedrooms, sleeps, areaname, tagline",
            "limit": str(limite)
        }
        
        if camere_minime:
            params["bedrooms"] = f"gte.{camere_minime}"

        try:
            response = requests.get(url, headers=self._get_headers(), params=params)
            response.raise_for_status()
            data = response.json()
            
            if not data:
                return "Mi dispiace, non ho trovato ville con questi criteri nel database."
                
            out = "Ecco alcune ville trovate nel database:\n"
            for v in data:
                out += f"- **{v.get('villa_name')}** ({v.get('bedrooms')} camere, max {v.get('sleeps')} persone) situata a {v.get('areaname')}\n"
            return out
        except Exception as e:
            return f"Errore di sistema (database query): {str(e)}"
            
    def cerca_barche(self, limite: int = 5, tipo: str = None) -> str:
        """
        Cerca barche a noleggio nel database. Usa questo tool ogni volta che chiedono una barca, gommone o yacht.
        
        :param limite: Numero massimo di risultati da ritornare (default: 5).
        :param tipo: Filtro per tipologia di barca, es. 'Yacht', 'Sailing', se richiesto espressamente dall'utente.
        :return: Lista di barche disponibili con prezzi.
        """
        url = f"{self.valves.SUPABASE_URL}/rest/v1/invenio_boats"
        
        params = {
            "select": "boat_name, type, length_ft, daily_price",
            "limit": str(limite)
        }
        
        if tipo:
            params["type"] = f"eq.{tipo}"

        try:
            response = requests.get(url, headers=self._get_headers(), params=params)
            response.raise_for_status()
            data = response.json()
            
            if not data:
                return "Nessuna barca trovata nel database corrispondente ai criteri."
                
            out = "Ecco le barche presenti a sistema:\n"
            for b in data:
                out += f"- **{b.get('boat_name')}** (Tipo: {b.get('type')}, {b.get('length_ft')} piedi, a partire da €{b.get('daily_price')}/giorno)\n"
            return out
        except Exception as e:
            return f"Errore di sistema (database query): {str(e)}"
