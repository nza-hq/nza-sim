import json
H=3.2
blocks=[[[0,0],[36,0],[36,12],[14,12],[14,30],[0,30]]]
def rect(x0,y0,x1,y1): return [[x0,y0],[x1,y0],[x1,y1],[x0,y1]]
rooms_def=[
 # id, name, rect, space, heating, cooling, vent, emitters
 ('r1','Café',rect(0,0,14,8),'s_cafe','y_boiler',None,None,[('et_rad_b',4)]),
 ('r2','Kitchen',rect(0,8,14,12),'s_kitchen','y_boiler',None,'y_mev_k',[('et_rad_b',2)]),
 ('r3','Reception',rect(14,0,20,12),'s_reception','y_ashp',None,'y_mvhr',[('et_rad_hp',3)]),
 ('r4','Open-plan office',rect(20,0,31,12),'s_office','y_ashp','y_split','y_mvhr',[('et_rad_hp',8)]),
 ('r5','Meeting room',rect(31,0,36,9),'s_meeting','y_vrf','y_vrf_c','y_mvhr',[('et_vrf',2)]),
 ('r6','Comms room',rect(31,9,36,12),'s_comms',None,'y_vrf_c',None,[]),
 ('r7','Store',rect(0,12,7,16),'s_store','y_panel',None,None,[('et_panel',2)]),
 ('r8','WCs',rect(7,12,14,16),'s_wc','y_boiler',None,'y_mev_w',[('et_rad_b',2)]),
 ('r9','Main hall',rect(0,16,14,30),'s_hall','y_boiler',None,None,[('et_rad_b',8)]),
]
rooms=[];zones=[]
for i,(rid,name,ring,sp,h,c,v,em) in enumerate(rooms_def):
    zid=f'z{i+1}'
    sys={} if rid=='r7' else {'dhw':'y_dhw'}
    if h: sys['heating']=h
    if c: sys['cooling']=c
    if v: sys['ventilation']=v
    r={'id':rid,'name':name,'ring':ring,'zone':zid,'space':sp,'systems':sys}
    if em: r['emitters']=[{'type':t,'count':n} for t,n in em]
    rooms.append(r)
    zones.append({'id':zid,'name':name,'use':None,'heating':None,'cooling':None})
wins=[];n=[0]
def W(wall,t,w,h=1.5,sill=0.9,door=False,shade=0):
    n[0]+=1; d={'id':f'w{n[0]}','wall':wall,'t_m':t,'width_m':w,'height_m':h,'sill_m':sill,'shading_m':shade}
    if door: d['door']=True
    wins.append(d)
# run 0 south (x)
for t in (1.0,4.6,8.2,11.6): W(0,t,1.8,shade=0.4)
W(0,14.5,1.2); W(0,16.5,1.8,h=2.1,sill=0.05)  # glazed entrance (library has no door construction)
for t in (20.8,23.4,26.0,28.6): W(0,t,2.0,shade=0.6)
W(0,32.3,2.4,shade=0.6)
# run 1 east (y)
W(1,3.5,2.0)
# run 2 north, t=36-x
for t in (6.5,9.5,12.5): W(2,t,2.0)
W(2,18.0,1.5)
# run 3 east of hall wing, t=y-12
W(3,1.7,0.6,h=0.6,sill=1.8)
for t in (5.0,8.5,12.0,15.5): W(3,t,2.0,h=1.8,sill=1.0)
# run 4 north of hall, t=14-x
for t in (2.0,6.0,10.0): W(4,t,2.0,h=1.8,sill=1.0)
# run 5 west, t=30-y
for t in (2.0,6.0,10.0): W(5,t,2.0,h=1.8,sill=1.0)
W(5,15.4,1.2,h=2.1,sill=0.05)
W(5,19.4,1.2,h=1.2,sill=1.1)
W(5,23.2,1.8); W(5,26.8,1.8)
fabric=[
 {'id':'f_wall','element':'wall','name':'External wall','construction':None,'u':None},
 {'id':'f_glazing','element':'glazing','name':'Windows','construction':None,'u':None},
 {'id':'f_door','element':'door','name':'Doors','construction':None,'u':1.8},
 {'id':'f_roof','element':'roof','name':'Roof','construction':None,'u':None},
 {'id':'f_floor','element':'floor','name':'Ground floor','construction':None,'u':None},
 {'id':'f_partition','element':'partition','name':'Block partition','construction':'interior_wall_block_plastered','u':None},
]
spans=[]
G=dict(radiant_fraction=0.3,light_area_share=1,light_gain_fraction=1,light_relationship='proportional_with_spill',daylight_factor=0.6,equip_area_share=1,equip_gain_fraction=1,equip_relationship='proportional',standby_factor=0.1)
def S(id,name,use,occ,ppm2,rate,light,lw,ew,eb,heat,cool,**kw):
    d=dict(id=id,name=name,use=use,occupancy=occ,people_per_m2=ppm2,occupancy_rate=rate,sensible_w_per_person=75 if ppm2 else None,lighting=light,equipment=None,lighting_w_per_m2=lw,equipment_w_per_m2=ew,equipment_baseload_w_per_m2=eb,heat_c=heat,cool_c=cool,**G)
    d.update(kw); return {k:v for k,v in d.items() if v is not None or k in('occupancy','lighting','equipment','use')}
spaces=[
 S('s_office','Open-plan office','office','office_occupancy',0.1,0.8,'office_lighting',8,12,1,21,24),
 S('s_meeting','Meeting room','office','office_occupancy',0.5,0.4,'office_lighting',10,4,0.5,21,23),
 S('s_reception','Reception','public','hotel_reception_occupancy',0.05,0.8,'hotel_corridor_lighting',10,3,0.5,20,None),
 S('s_cafe','Café','retail','retail_occupancy',0.3,0.5,None,10,5,1,20,None),
 S('s_kitchen','Café kitchen','other','retail_occupancy',0.08,0.8,None,12,40,5,18,None),
 S('s_hall','Community hall','public','hotel_reception_occupancy',0.4,0.35,None,10,2,0.5,19,None),
 S('s_comms','Comms room','other','always_on',0.001,1,None,None,120,0,None,24),
 S('s_store','Store','other',None,None,None,None,None,None,None,12,None),
 S('s_wc','WCs','other','office_occupancy',0.05,0.8,'office_lighting',6,0,0,18,None),
]
systems=[
 {'id':'y_boiler','service':'heating','name':'Gas boiler 1','template':'gas_boiler_heating','design_flow_c':70,'design_return_c':50},
 {'id':'y_ashp','service':'heating','name':'Air source heat pump','template':'ashp_heating','design_flow_c':45,'design_return_c':35},
 {'id':'y_vrf','service':'heating','name':'VRF (meeting room)','template':'vrf_standard'},
 {'id':'y_panel','service':'heating','name':'Electric panel heaters','template':'electric_panel_heating'},
 {'id':'y_split','service':'cooling','name':'Split cooling (office)','template':'split_system_cooling'},
 {'id':'y_vrf_c','service':'cooling','name':'VRF cooling','template':'vrf_standard'},
 {'id':'y_mvhr','service':'ventilation','name':'MVHR (office wing)','template':'mvhr_standard','flow':1.0,'schedule':'hotel_ventilation_occupied'},
 {'id':'y_mev_k','service':'ventilation','name':'Kitchen extract','template':'mev_standard','flow':3.0,'schedule':'hotel_ventilation_timer'},
 {'id':'y_mev_w','service':'ventilation','name':'WC extract','template':'mev_standard','flow':1.5,'schedule':'hotel_ventilation_timer'},
 {'id':'y_dhw','service':'dhw','name':'Gas boiler 1 (hot water)','template':'gas_boiler_dhw'},
]
et=[
 {'id':'et_rad_b','name':'Radiator K2 600×1400 (boiler)','kind':'radiator','rated_output_w':2350,'radiant_fraction':0.3,'rated_flow_c':75,'rated_return_c':65,'rated_room_c':20,'exponent_n':1.33},
 {'id':'et_rad_hp','name':'Radiator K2 600×2000 (heat pump)','kind':'radiator','rated_output_w':3360,'radiant_fraction':0.3,'rated_flow_c':75,'rated_return_c':65,'rated_room_c':20,'exponent_n':1.33},
 {'id':'et_vrf','name':'VRF cassette 3.6 kW','kind':'vrf_indoor','rated_output_w':3600,'radiant_fraction':0,'rated_flow_c':None,'rated_return_c':None,'rated_room_c':None,'exponent_n':None},
 {'id':'et_panel','name':'Panel heater 1 kW','kind':'electric','rated_output_w':1000,'radiant_fraction':0.2,'rated_flow_c':None,'rated_return_c':None,'rated_room_c':None,'exponent_n':None},
]
plan=dict(blocks=blocks,rooms=rooms,zones=zones,systems=systems,storey_height_m=H,windows=wins,fabric_types=fabric,wall_spans=spans,spaces=spaces,
 profiles=['office_occupancy','office_lighting','retail_occupancy','hotel_reception_occupancy','hotel_corridor_lighting','hotel_ventilation_occupied','hotel_ventilation_timer'],
 building={'q50':5,'tb_multiplier':1,'exposure':'normal'},emitter_types=et,
 dhw={'storage_c':60,'tap_c':43,'cold_c':10,'basis':'per_person','litres':4,'pump_w':60,'shape':'follow_occupancy'},
 next={'room':10,'zone':10,'system':11})
out={'_note':'Worked example (16 Nov 2026): an L-shaped single-storey community centre, nine rooms in nine zones, drawn with the editor\'s own plan shape. Every typed value is an example input chosen for the demonstration, not a real building. Load with window.sim2.loadPlan(fixture.plan).','plan':plan}
json.dump(out,open('/tmp/claude-0/base.plan.json','w'),indent=1,ensure_ascii=False)
print(len(wins),'windows')
