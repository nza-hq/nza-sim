"""
Worked example (16 Nov 2026), EnergyPlus-only PREVIEW of the window tests Linzie asked for, which our engine cannot
run until Brief 115 (natural ventilation) lands. One room of the community centre example, the open-plan office
(11 x 12 x 3.2 m, south and north walls outside, partitions to the reception and meeting room taken as adiabatic),
with the example's fabric U-values, glazing, gains and heating hours. Windows open through EnergyPlus's simple
ZoneVentilation:WindandStackOpenArea model (wind + stack, one object per facade), not the AirflowNetwork that
Brief 115 will be refereed against, so read the numbers as a preview of size, not as the product's answer.

Run:  python3 scripts/example_windows_ep.py <energyplus dir> <weather.epw> <out dir>
"""
import json, os, sqlite3, subprocess, sys

EP, EPW, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
L, D, H = 11.0, 12.0, 3.2           # x along the south wall, y deep, storey height
WINS = {'south': [(0.8, 2.0), (3.4, 2.0), (6.0, 2.0), (8.6, 2.0)], 'north': [(1.5, 2.0), (4.5, 2.0), (7.5, 2.0)]}
WIN_H, SILL = 1.5, 0.9
WIN_AREA = sum(w for v in WINS.values() for _, w in v) * WIN_H   # 21 m2
FLOOR = L * D

def day(a, b, on=1.0, offv=0.0):
    return [on if a <= h < b else offv for h in range(24)]

def compact(name, typ, rules):
    """rules: list of (through 'MM/DD', {daytype: 24 values})"""
    data = []
    for thru, days in rules:
        data.append({'field': f'Through: {thru}'})
        for dt, vals in days.items():
            data.append({'field': f'For: {dt}'})
            for h, v in enumerate(vals):
                data.append({'field': f'Until: {h+1:02d}:00'}); data.append({'field': v})
    return {name: {'schedule_type_limits_name': typ, 'data': data}}

OFFICE_OCC = [0,0,0,0,0,0,0,0.1,0.45,0.85,0.95,1,0.75,0.8,0.95,0.95,0.85,0.65,0.35,0.1,0,0,0,0]   # office_occupancy shape (library)
OFFICE_LIGHT = [0,0,0,0,0,0,0,0.1,0.45,0.8,0.85,0.9,0.65,0.85,0.9,0.85,0.7,0.2,0.05,0,0,0,0,0]
def lib_shape(key):
    snap = json.load(open(os.path.join(os.path.dirname(__file__), '../frontend/src/sim2/library/snapshot.json')))
    return next(p for p in snap['profiles'] if p['key'] == key)['day_types']

def model(case):
    occ = lib_shape('office_occupancy'); light = lib_shape('office_lighting'); vent = lib_shape('hotel_ventilation_occupied')
    m = {
        'Version': {'Version 1': {'version_identifier': '25.2'}},
        'SimulationControl': {'SimulationControl 1': {'do_zone_sizing_calculation': 'No', 'do_system_sizing_calculation': 'No', 'do_plant_sizing_calculation': 'No', 'run_simulation_for_sizing_periods': 'No', 'run_simulation_for_weather_file_run_periods': 'Yes'}},
        'Building': {'Office': {'north_axis': 0, 'terrain': 'Suburbs', 'solar_distribution': 'FullExterior', 'maximum_number_of_warmup_days': 25}},
        'Timestep': {'Timestep 1': {'number_of_timesteps_per_hour': 4}},
        'RunPeriod': {'Year': {'begin_month': 1, 'begin_day_of_month': 1, 'end_month': 12, 'end_day_of_month': 31, 'day_of_week_for_start_day': 'Monday', 'use_weather_file_holidays_and_special_days': 'No', 'use_weather_file_daylight_saving_period': 'No'}},
        'GlobalGeometryRules': {'GlobalGeometryRules 1': {'starting_vertex_position': 'UpperLeftCorner', 'vertex_entry_direction': 'Counterclockwise', 'coordinate_system': 'World'}},
        'Site:GroundTemperature:BuildingSurface': {'G': {f'{mo}_ground_temperature': 10.2 for mo in ['january','february','march','april','may','june','july','august','september','october','november','december']}},
        'ScheduleTypeLimits': {'Fraction': {'lower_limit_value': 0, 'upper_limit_value': 1, 'numeric_type': 'Continuous'}, 'Temp': {'numeric_type': 'Continuous'}, 'Any': {'numeric_type': 'Continuous'}, 'Ctl': {'numeric_type': 'Discrete'}},
        'Schedule:Compact': {},
        'Material': {
            'Brick': {'roughness': 'Rough', 'thickness': 0.1, 'conductivity': 0.77, 'density': 1700, 'specific_heat': 800, 'solar_absorptance': 0.6, 'thermal_absorptance': 0.9},
            'WallIns': {'roughness': 'Smooth', 'thickness': 0.16, 'conductivity': 0.032, 'density': 30, 'specific_heat': 1400},
            'Block': {'roughness': 'Rough', 'thickness': 0.1, 'conductivity': 0.51, 'density': 1400, 'specific_heat': 1000},
            'Plaster': {'roughness': 'Smooth', 'thickness': 0.013, 'conductivity': 0.57, 'density': 1300, 'specific_heat': 1000},
            'RoofMem': {'roughness': 'Rough', 'thickness': 0.01, 'conductivity': 0.2, 'density': 1100, 'specific_heat': 1000, 'solar_absorptance': 0.7, 'thermal_absorptance': 0.9},
            'RoofIns': {'roughness': 'Smooth', 'thickness': 0.29, 'conductivity': 0.032, 'density': 30, 'specific_heat': 1400},
            'Deck': {'roughness': 'Rough', 'thickness': 0.15, 'conductivity': 1.4, 'density': 2300, 'specific_heat': 900},
            'FloorIns': {'roughness': 'Smooth', 'thickness': 0.20, 'conductivity': 0.032, 'density': 30, 'specific_heat': 1400},
            'Screed': {'roughness': 'Rough', 'thickness': 0.065, 'conductivity': 1.15, 'density': 2000, 'specific_heat': 1000},
        },
        'WindowMaterial:SimpleGlazingSystem': {'DGU': {'u_factor': 1.4, 'solar_heat_gain_coefficient': 0.42, 'visible_transmittance': 0.7}},
        'Construction': {
            'Wall': {'outside_layer': 'Brick', 'layer_2': 'WallIns', 'layer_3': 'Block', 'layer_4': 'Plaster'},
            'Roof': {'outside_layer': 'RoofMem', 'layer_2': 'RoofIns', 'layer_3': 'Deck'},
            'Floor': {'outside_layer': 'FloorIns', 'layer_2': 'Deck', 'layer_3': 'Screed'},
            'Partition': {'outside_layer': 'Plaster', 'layer_2': 'Block', 'layer_3': 'Plaster'},
            'Glazing': {'outside_layer': 'DGU'},
        },
        'Zone': {'Office': {'x_origin': 0, 'y_origin': 0, 'z_origin': 0, 'multiplier': 1}},
        'BuildingSurface:Detailed': {}, 'FenestrationSurface:Detailed': {},
        'Output:SQLite': {'Output:SQLite 1': {'option_type': 'Simple'}},
        'Output:Variable': {}, 'Output:Diagnostics': {'D': {'diagnostics': [{'key': 'DisplayExtraWarnings'}]}},
    }
    S = m['Schedule:Compact']
    def sched(name, typ, wd, sat, sun, months=None):
        if months is None: S.update(compact(name, typ, [('12/31', {'Weekdays': wd, 'Saturday': sat, 'Sunday': sun, 'AllOtherDays': sun})]))
        else: S.update(compact(name, typ, months))
    sched('Occ', 'Fraction', occ['weekday'], occ['saturday'], occ['sunday'])
    sched('Light', 'Fraction', light['weekday'], light['saturday'], light['sunday'])
    sched('Always', 'Fraction', [1]*24, [1]*24, [1]*24)
    sched('Activity', 'Any', [120]*24, [120]*24, [120]*24)
    sched('Vent', 'Fraction', vent['weekday'], vent['saturday'], vent['sunday'])
    inuse = day(7, 18)
    sched('HeatSP', 'Temp', [21 if x else 16 for x in inuse], [16]*24, [16]*24)
    sched('CoolSP', 'Temp', [24 if x else 50 for x in inuse], [50]*24, [50]*24)
    sched('Dual', 'Ctl', [4]*24, [4]*24, [4]*24)
    # Surfaces: floor, roof, walls.
    B = m['BuildingSurface:Detailed']
    def surf(name, typ, cons, bc, verts, sun=True):
        B[name] = {'surface_type': typ, 'construction_name': cons, 'zone_name': 'Office', 'outside_boundary_condition': bc,
                   'sun_exposure': 'SunExposed' if sun else 'NoSun', 'wind_exposure': 'WindExposed' if sun else 'NoWind',
                   'vertices': [{'vertex_x_coordinate': x, 'vertex_y_coordinate': y, 'vertex_z_coordinate': z} for x, y, z in verts]}
    surf('Floor', 'Floor', 'Floor', 'Ground', [(L, 0, 0), (0, 0, 0), (0, D, 0), (L, D, 0)], sun=False)
    surf('Roof', 'Roof', 'Roof', 'Outdoors', [(0, D, H), (0, 0, H), (L, 0, H), (L, D, H)])
    surf('South', 'Wall', 'Wall', 'Outdoors', [(0, 0, H), (0, 0, 0), (L, 0, 0), (L, 0, H)])
    surf('North', 'Wall', 'Wall', 'Outdoors', [(L, D, H), (L, D, 0), (0, D, 0), (0, D, H)])
    surf('West', 'Wall', 'Partition', 'Adiabatic', [(0, D, H), (0, D, 0), (0, 0, 0), (0, 0, H)], sun=False)
    surf('East', 'Wall', 'Partition', 'Adiabatic', [(L, 0, H), (L, 0, 0), (L, D, 0), (L, D, H)], sun=False)
    F = m['FenestrationSurface:Detailed']
    for i, (x0, w) in enumerate(WINS['south']):
        z0, z1 = SILL, SILL + WIN_H
        F[f'S{i}'] = {'surface_type': 'Window', 'construction_name': 'Glazing', 'building_surface_name': 'South', 'number_of_vertices': 4,
                      'vertex_1_x_coordinate': x0, 'vertex_1_y_coordinate': 0, 'vertex_1_z_coordinate': z1, 'vertex_2_x_coordinate': x0, 'vertex_2_y_coordinate': 0, 'vertex_2_z_coordinate': z0,
                      'vertex_3_x_coordinate': x0 + w, 'vertex_3_y_coordinate': 0, 'vertex_3_z_coordinate': z0, 'vertex_4_x_coordinate': x0 + w, 'vertex_4_y_coordinate': 0, 'vertex_4_z_coordinate': z1}
    for i, (x0, w) in enumerate(WINS['north']):
        z0, z1 = SILL, SILL + WIN_H
        xa, xb = L - x0, L - x0 - w
        F[f'N{i}'] = {'surface_type': 'Window', 'construction_name': 'Glazing', 'building_surface_name': 'North', 'number_of_vertices': 4,
                      'vertex_1_x_coordinate': xa, 'vertex_1_y_coordinate': D, 'vertex_1_z_coordinate': z1, 'vertex_2_x_coordinate': xa, 'vertex_2_y_coordinate': D, 'vertex_2_z_coordinate': z0,
                      'vertex_3_x_coordinate': xb, 'vertex_3_y_coordinate': D, 'vertex_3_z_coordinate': z0, 'vertex_4_x_coordinate': xb, 'vertex_4_y_coordinate': D, 'vertex_4_z_coordinate': z1}
    # Gains as the example's office space type: 0.1 people/m2 x 0.8 occupancy rate, 75 W sensible each; 8 W/m2 lights;
    # 12 W/m2 equipment when in use + 1 W/m2 always on.
    m['People'] = {'People': {'zone_or_zonelist_or_space_or_spacelist_name': 'Office', 'number_of_people_schedule_name': 'Occ', 'number_of_people_calculation_method': 'People/Area', 'people_per_floor_area': 0.08, 'fraction_radiant': 0.3, 'sensible_heat_fraction': 0.625, 'activity_level_schedule_name': 'Activity'}}
    m['Lights'] = {'Lights': {'zone_or_zonelist_or_space_or_spacelist_name': 'Office', 'schedule_name': 'Light', 'design_level_calculation_method': 'Watts/Area', 'watts_per_floor_area': 8, 'fraction_radiant': 0.3, 'fraction_visible': 0.0}}
    m['ElectricEquipment'] = {'Equip': {'zone_or_zonelist_or_space_or_spacelist_name': 'Office', 'schedule_name': 'Occ', 'design_level_calculation_method': 'Watts/Area', 'watts_per_floor_area': 12, 'fraction_radiant': 0.3},
                              'Base': {'zone_or_zonelist_or_space_or_spacelist_name': 'Office', 'schedule_name': 'Always', 'design_level_calculation_method': 'Watts/Area', 'watts_per_floor_area': 1, 'fraction_radiant': 0.3}}
    # Air leakage: q50 5 m3/h.m2 by n50/20 over walls, roof and floor (as our engine's 'today' method): ~0.2 ach.
    env = 2 * L * H + 2 * FLOOR
    ach = 5 * env / 20 / (FLOOR * H)
    m['ZoneInfiltration:DesignFlowRate'] = {'Leak': {'zone_or_zonelist_or_space_or_spacelist_name': 'Office', 'schedule_name': 'Always', 'design_flow_rate_calculation_method': 'AirChanges/Hour', 'air_changes_per_hour': round(ach, 4), 'constant_term_coefficient': 1, 'temperature_term_coefficient': 0, 'velocity_term_coefficient': 0, 'velocity_squared_term_coefficient': 0}}
    # MVHR 1 l/s per m2 on its schedule: in winter as the 18 % of the air it does not recover heat from; in summer
    # (May to September, bypass) as the whole flow.
    q = 0.001 * FLOOR
    S.update(compact('VentWinter', 'Fraction', [('04/30', {'AllDays': [v * 0.18 for v in vent['weekday']]}), ('09/30', {'AllDays': [0]*24}), ('12/31', {'AllDays': [v * 0.18 for v in vent['weekday']]})]))
    S.update(compact('VentSummer', 'Fraction', [('04/30', {'AllDays': [0]*24}), ('09/30', {'AllDays': vent['weekday']}), ('12/31', {'AllDays': [0]*24})]))
    m['ZoneVentilation:DesignFlowRate'] = {
        'MVHR_w': {'zone_or_zonelist_or_space_or_spacelist_name': 'Office', 'schedule_name': 'VentWinter', 'design_flow_rate_calculation_method': 'Flow/Zone', 'design_flow_rate': q, 'ventilation_type': 'Balanced', 'constant_term_coefficient': 1, 'temperature_term_coefficient': 0, 'velocity_term_coefficient': 0, 'velocity_squared_term_coefficient': 0, 'minimum_indoor_temperature': -100},
        'MVHR_s': {'zone_or_zonelist_or_space_or_spacelist_name': 'Office', 'schedule_name': 'VentSummer', 'design_flow_rate_calculation_method': 'Flow/Zone', 'design_flow_rate': q, 'ventilation_type': 'Balanced', 'constant_term_coefficient': 1, 'temperature_term_coefficient': 0, 'velocity_term_coefficient': 0, 'velocity_squared_term_coefficient': 0, 'minimum_indoor_temperature': -100},
    }
    # Windows open: one object per facade, its share of the window area.
    if case.get('open'):
        o = case['open']
        S.update(compact('OpenSched', 'Fraction', o['schedule']))
        objs = {}
        for fac, ang in (('south', 180), ('north', 0)):
            area = sum(w for _, w in WINS[fac]) * WIN_H * o['fraction']
            objs[f'Open_{fac}'] = {'zone_or_space_name': 'Office', 'opening_area': round(area, 4), 'opening_area_fraction_schedule_name': 'OpenSched', 'opening_effectiveness': 'Autocalculate', 'effective_angle': ang, 'height_difference': WIN_H / 2, 'discharge_coefficient_for_opening': 'Autocalculate',
                                   'minimum_indoor_temperature': o.get('min_in', -100), 'maximum_indoor_temperature': 100, 'delta_temperature': o.get('delta', -100), 'minimum_outdoor_temperature': -100, 'maximum_outdoor_temperature': 100, 'maximum_wind_speed': 40}
        if o.get('night'):
            S.update(compact('NightSched', 'Fraction', o['night']))
            for fac, ang in (('south', 180), ('north', 0)):
                area = sum(w for _, w in WINS[fac]) * WIN_H * o['fraction']
                objs[f'Night_{fac}'] = {**objs[f'Open_{fac}'], 'opening_area_fraction_schedule_name': 'NightSched', 'minimum_indoor_temperature': 20, 'delta_temperature': 2}
        m['ZoneVentilation:WindandStackOpenArea'] = objs
    # Heating (and cooling) as ideal loads; heating limited to the radiators' output at 45/35 when asked.
    hp = case.get('heat_cap_w')
    cool = case.get('cool', False)
    S.update(compact('HeatAvail', 'Fraction', [('12/31', {'AllDays': [1]*24})]))
    S.update(compact('CoolAvail', 'Fraction', [('12/31', {'AllDays': [1 if cool else 0]*24})]))
    m['ThermostatSetpoint:DualSetpoint'] = {'DualSP': {'heating_setpoint_temperature_schedule_name': 'HeatSP', 'cooling_setpoint_temperature_schedule_name': 'CoolSP'}}
    m['ZoneControl:Thermostat'] = {'Tstat': {'zone_or_zonelist_name': 'Office', 'control_type_schedule_name': 'Dual', 'control_1_object_type': 'ThermostatSetpoint:DualSetpoint', 'control_1_name': 'DualSP'}}
    m['ZoneHVAC:IdealLoadsAirSystem'] = {'Ideal': {'zone_supply_air_node_name': 'Supply', 'heating_limit': 'LimitCapacity' if hp else 'NoLimit', **({'maximum_sensible_heating_capacity': hp} if hp else {}), 'cooling_availability_schedule_name': 'CoolAvail', 'heating_availability_schedule_name': 'HeatAvail', 'dehumidification_control_type': 'None', 'humidification_control_type': 'None'}}
    m['ZoneHVAC:EquipmentList'] = {'Equip': {'load_distribution_scheme': 'SequentialLoad', 'equipment': [{'zone_equipment_object_type': 'ZoneHVAC:IdealLoadsAirSystem', 'zone_equipment_name': 'Ideal', 'zone_equipment_cooling_sequence': 1, 'zone_equipment_heating_or_no_load_sequence': 1}]}}
    m['ZoneHVAC:EquipmentConnections'] = {'OfficeConn': {'zone_name': 'Office', 'zone_conditioning_equipment_list_name': 'Equip', 'zone_air_inlet_node_or_nodelist_name': 'Supply', 'zone_air_node_name': 'OfficeAir', 'zone_return_air_node_or_nodelist_name': 'Return'}}
    for i, v in enumerate(['Zone Mean Air Temperature', 'Zone Operative Temperature', 'Zone Ideal Loads Zone Sensible Heating Rate', 'Zone Ideal Loads Zone Sensible Cooling Rate', 'Zone Ventilation Current Density Air Change Rate', 'Site Outdoor Air Drybulb Temperature', 'Site Wind Speed']):
        m['Output:Variable'][f'V{i}'] = {'key_value': '*', 'variable_name': v, 'reporting_frequency': 'Hourly'}
    return m

def run(name, case):
    d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
    p = os.path.join(d, 'in.epJSON'); json.dump(model(case), open(p, 'w'))
    r = subprocess.run([os.path.join(EP, 'energyplus'), '-w', EPW, '-d', d, p], capture_output=True, text=True)
    err = open(os.path.join(d, 'eplusout.err')).read()
    if r.returncode != 0 or 'Severe' in err and '** Severe  **' in err:
        print(err[-3000:]); raise SystemExit(name + ' failed')
    con = sqlite3.connect(os.path.join(d, 'eplusout.sql'))
    def series(var):
        rows = con.execute("select t.Month, t.Day, t.Hour, t.DayType, rd.Value from ReportData rd join ReportDataDictionary dd on rd.ReportDataDictionaryIndex=dd.ReportDataDictionaryIndex join Time t on rd.TimeIndex=t.TimeIndex where dd.Name=? and coalesce(t.WarmupFlag,0)=0 order by rd.TimeIndex", (var,)).fetchall()
        return rows
    ta = series('Zone Mean Air Temperature'); to = series('Zone Operative Temperature')
    ht = series('Zone Ideal Loads Zone Sensible Heating Rate'); ct = series('Zone Ideal Loads Zone Sensible Cooling Rate')
    ach = series('Zone Ventilation Current Density Air Change Rate'); tout = series('Site Outdoor Air Drybulb Temperature'); wind = series('Site Wind Speed')
    assert len(ta) == 8760, len(ta)
    return {'name': name, 'case': {k: v for k, v in case.items() if k != 'open'} | ({'open_fraction': case['open']['fraction']} if case.get('open') else {}),
            'month': [r[0] for r in ta], 'hour': [r[2] for r in ta], 'daytype': [r[3] for r in ta],
            't_air': [round(r[4], 2) for r in ta], 't_op': [round(r[4], 2) for r in to], 'heat_w': [round(r[4], 1) for r in ht], 'cool_w': [round(r[4], 1) for r in ct],
            'vent_ach': [round(r[4], 3) for r in ach] if ach else None, 't_out': [round(r[4], 2) for r in tout], 'wind': [round(r[4], 2) for r in wind]}

winter = [('04/30', {'AllDays': [1]*24}), ('09/30', {'AllDays': [0]*24}), ('12/31', {'AllDays': [1]*24})]
inuse_summer = [('04/30', {'AllDays': [0]*24}), ('09/30', {'Weekdays': day(7, 18), 'AllOtherDays': [0]*24}), ('12/31', {'AllDays': [0]*24})]
night_summer = [('04/30', {'AllDays': [0]*24}), ('09/30', {'AllDays': [1 if (h >= 22 or h < 7) else 0 for h in range(24)]}), ('12/31', {'AllDays': [0]*24})]
CASES = {
    'W0_shut': {},
    'W0_shut_capped': {'heat_cap_w': 7223},
    'W1_crack': {'open': {'fraction': 0.05, 'schedule': winter}},
    'W1_crack_capped': {'open': {'fraction': 0.05, 'schedule': winter}, 'heat_cap_w': 7223},
    'W2_open': {'open': {'fraction': 0.25, 'schedule': winter}},
    'W2_open_capped': {'open': {'fraction': 0.25, 'schedule': winter}, 'heat_cap_w': 7223},
    'S0_shut_nocool': {},
    'S1_natvent_day': {'open': {'fraction': 0.25, 'schedule': inuse_summer, 'min_in': 22, 'delta': 0}},
    'S2_natvent_day_night': {'open': {'fraction': 0.25, 'schedule': inuse_summer, 'min_in': 22, 'delta': 0, 'night': night_summer}},
    'S3_cooling': {'cool': True},
}
res = {k: run(k, v) for k, v in CASES.items()}
json.dump({'source': 'scripts/example_windows_ep.py', 'energyplus': '25.2.0', 'weather': os.path.basename(EPW), 'win_area_m2': WIN_AREA, 'floor_m2': FLOOR, 'results': res}, open(os.path.join(OUT, 'windows_ep.json'), 'w'))
print('done')
