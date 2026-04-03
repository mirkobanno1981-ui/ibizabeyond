import React from 'react';

export default function BookingCalendar({ bookings }) {
  const [currentDate, setCurrentDate] = React.useState(new Date());

  // Get days in month
  const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const days = [];
  const totalDays = daysInMonth(year, month);
  const offset = firstDayOfMonth(year, month);

  // Weekday headers
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Identify bookings for each day
  const getBookingsForDay = (day) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return bookings.filter(b => {
      const checkIn = b.check_in;
      const checkOut = b.check_out;
      return dateStr >= checkIn && dateStr <= checkOut;
    });
  };

  return (
    <div className="glass-card overflow-hidden border-border/40 animate-in fade-in duration-500">
      <header className="p-4 flex items-center justify-between border-b border-border/40 bg-white/2">
        <h3 className="text-lg font-black text-text-primary capitalize tracking-tight">
          {currentDate.toLocaleString('default', { month: 'long' })} {year}
        </h3>
        <div className="flex gap-2">
          <button onClick={prevMonth} className="size-8 rounded-lg bg-surface-2 hover:bg-primary/10 flex items-center justify-center transition-colors">
            <span className="material-symbols-outlined notranslate text-lg">chevron_left</span>
          </button>
          <button onClick={nextMonth} className="size-8 rounded-lg bg-surface-2 hover:bg-primary/10 flex items-center justify-center transition-colors">
            <span className="material-symbols-outlined notranslate text-lg">chevron_right</span>
          </button>
        </div>
      </header>

      <div className="grid grid-cols-7 border-b border-border/40">
        {weekdays.map(d => (
          <div key={d} className="py-2 text-center text-[10px] font-black text-text-muted uppercase tracking-widest bg-background/30">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 bg-white/1 overflow-hidden">
        {/* Fill offsets */}
        {Array.from({ length: offset }).map((_, i) => (
          <div key={`offset-${i}`} className="h-24 sm:h-32 border-b border-r border-border/10"></div>
        ))}

        {/* Calendar days */}
        {Array.from({ length: totalDays }).map((_, i) => {
          const day = i + 1;
          const dayBookings = getBookingsForDay(day);
          const isToday = new Date().toDateString() === new Date(year, month, day).toDateString();

          return (
            <div key={day} className={`h-24 sm:h-32 border-b border-r border-border/10 p-1 sm:p-2 transition-colors hover:bg-primary/5 group relative ${isToday ? 'bg-primary/5' : ''}`}>
              <span className={`text-xs font-bold ${isToday ? 'text-primary' : 'text-text-muted'} group-hover:text-text-primary`}>
                {day}
              </span>
              
              <div className="mt-1 space-y-1">
                {dayBookings.map(b => {
                  const isCheckIn = b.check_in === `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const isCheckOut = b.check_out === `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const isPaid = b.deposit_paid && b.balance_paid;

                  return (
                    <div 
                      key={b.id} 
                      className={`px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-bold truncate transition-all flex items-center gap-1 shadow-sm ${
                        isCheckIn ? 'bg-green-500/20 text-green-500 border-l-2 border-green-500' : 
                        isCheckOut ? 'bg-red-500/20 text-red-500 border-l-2 border-red-500' : 
                        'bg-primary/10 text-primary border-l-2 border-primary/50'
                      }`}
                      title={`${b.invenio_properties?.villa_name} - ${b.clients?.full_name}`}
                    >
                      {isCheckIn && <span className="material-symbols-outlined notranslate text-[10px]">login</span>}
                      {isCheckOut && <span className="material-symbols-outlined notranslate text-[10px]">logout</span>}
                      <span className="flex-1 truncate">{b.invenio_properties?.villa_name}</span>
                      {isPaid && <span className="size-1.5 rounded-full bg-blue-500"></span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Legend */}
      <footer className="p-4 border-t border-border/40 flex flex-wrap gap-4 text-[10px] font-bold text-text-muted uppercase tracking-widest bg-background/30">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-green-500"></span> Check-in
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-red-500"></span> Check-out
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-blue-500"></span> Fully Paid
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary/50"></span> Reservation
        </div>
      </footer>
    </div>
  );
}
